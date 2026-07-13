for (let index = 0; index < 1; index++) {
	check(top);
}

for (const value of [0]) {
	check(location);
}

for (const key in { key: true }) {
	check(top);
}

const globals = {
	top,
	location,
	nested: { top },
};
check(globals.top);
check(globals.location);
check(globals.nested.top);

const constructed = new top.constructor(top);
check(constructed);

let escaped;
[escaped] = [top];
check(escaped);
({ escaped } = { escaped: top });
check(escaped);

try {
	// An empty catch block must not crash the rewriter.
} catch (error) {}
