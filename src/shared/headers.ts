export class SherpaHeaders {
	headers = {};

	set(key: string, v: string) {
		this.headers[key.toLowerCase()] = v;
	}

	delete(key: string) {
		delete this.headers[key.toLowerCase()];
	}
}
