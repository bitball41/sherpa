export type AssignmentResult = {
	assign: boolean;
	value: any;
};

/** Evaluates the value side of a JavaScript assignment operator once. */
export function evaluateAssignment(
	left: any,
	operator: string,
	right: any
): AssignmentResult {
	switch (operator) {
		case "=":
			return { assign: true, value: right };
		case "+=":
			return { assign: true, value: left + right };
		case "-=":
			return { assign: true, value: left - right };
		case "*=":
			return { assign: true, value: left * right };
		case "/=":
			return { assign: true, value: left / right };
		case "%=":
			return { assign: true, value: left % right };
		case "**=":
			return { assign: true, value: left ** right };
		case "<<=":
			return { assign: true, value: left << right };
		case ">>=":
			return { assign: true, value: left >> right };
		case ">>>=":
			return { assign: true, value: left >>> right };
		case "&=":
			return { assign: true, value: left & right };
		case "^=":
			return { assign: true, value: left ^ right };
		case "|=":
			return { assign: true, value: left | right };
		case "&&=":
			return left
				? { assign: true, value: right }
				: { assign: false, value: left };
		case "||=":
			return left
				? { assign: false, value: left }
				: { assign: true, value: right };
		case "??=":
			return left === null || left === undefined
				? { assign: true, value: right }
				: { assign: false, value: left };
		default:
			throw new TypeError(`unsupported assignment operator ${operator}`);
	}
}
