export type AssignmentResult = {
    assign: boolean;
    value: any;
};
/** Evaluates the value side of a JavaScript assignment operator once. */
export declare function evaluateAssignment(left: any, operator: string, right: any): AssignmentResult;
