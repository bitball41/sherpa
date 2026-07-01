import { CookieStore } from "./cookie";
import { URLMeta } from "./rewriters/url";
export type HtmlRule = {
    [key: string]: "*" | string[] | ((...any: any[]) => string | null);
    fn: (value: string, meta: URLMeta, cookieStore: CookieStore) => string | null;
};
export declare const htmlRules: HtmlRule[];
export declare function findHtmlRule(attribute: string, elementName: string): HtmlRule | undefined;
