const LocalStorage = require("node-localstorage").LocalStorage;
const localStorage : {
	_keys: string[],
	getItem(key: string): string,
	setItem(key: string, value: string): void,
	removeItem(key: string): void,
} = new LocalStorage("./localstorage/");

export {localStorage};