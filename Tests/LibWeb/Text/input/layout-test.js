// Exact formatting-context work expectations. Keep measured steps synchronous and
// buffer output: writing test results into the document can invalidate later steps.

function normalizeLayoutTrace(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^ */)[0].length));
    return lines.map(line => line.slice(indent).trimEnd()).join("\n");
}

function layoutTraceDifference(expected, actual) {
    const left = normalizeLayoutTrace(expected).split("\n");
    const right = normalizeLayoutTrace(actual).split("\n");
    const index = left.findIndex((line, index) => line !== right[index]);
    if (index < 0 && left.length === right.length) return null;
    const line = index < 0 ? left.length : index;
    return `line ${line + 1}: expected ${JSON.stringify(left[line] ?? "<end>")}, got ${JSON.stringify(right[line] ?? "<end>")}`;
}

// Match the display-list helper's optional block-fixture preparation.
function removeBodyWhitespace() {
    for (const node of [...document.body.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
    }
}

// Also usable by scenario matrices that create and warm a fixture for each case.
function runLayoutTestStep(step, testInternals = internals) {
    if (typeof step.expect !== "string") throw new Error(`${step.name}: missing exact layout work expectation`);
    let error;
    let actual;
    testInternals.beginLayoutTrace();
    try {
        if (step.mutate?.()?.then) throw new Error("mutate must be synchronous");
        testInternals.updateLayoutForTesting();
        if (
            step.check?.((actual, expected, label) => {
                if (!Object.is(actual, expected)) {
                    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
                }
            })?.then
        )
            throw new Error("check must be synchronous");
    } catch (caught) {
        error = String(caught);
    } finally {
        actual = testInternals.takeLayoutTrace();
    }
    const difference = layoutTraceDifference(step.expect, actual);
    if (difference || error) {
        throw new Error(
            `${step.name}: ${[difference, error].filter(Boolean).join("\n")}\nActual layout trace:\n${actual.trimEnd()}\nEnd trace`
        );
    }
}

function layoutTest({ setup, steps, cleanup }) {
    promiseTest(async () => {
        const output = [];
        const originalDisplay = __outputElement.style.display;
        try {
            if (document.readyState !== "complete") {
                await new Promise(resolve => window.addEventListener("load", resolve, { once: true }));
            }
            __outputElement.style.display = "none";
            await setup?.();
            await document.fonts.ready;
            internals.updateLayoutForTesting();
            for (const step of steps) {
                try {
                    runLayoutTestStep(step);
                    output.push(`PASS: ${step.name} (work${step.check ? " + checks" : ""})`);
                } catch (error) {
                    output.push(`FAIL: ${error}`);
                }
            }
        } catch (error) {
            output.push(`FAIL: ${error}`);
        } finally {
            internals.takeLayoutTrace();
            try {
                await cleanup?.();
            } catch (error) {
                output.push(`FAIL: cleanup: ${error}`);
            }
            __outputElement.style.display = originalDisplay;
            for (const line of output) println(line);
        }
    });
}
