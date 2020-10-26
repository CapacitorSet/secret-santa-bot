import assert = require("assert");
// todo: remove?
assert("OWNER_ID" in process.env);
const OWNER_ID = process.env.OWNER_ID;

import TelegramBot = require("node-telegram-bot-api");
import {logger} from "../logger";
import {localStorage} from "../storage";

export class User {
	localStorage: any
	id: string

	constructor(source: number | string) {
		if (typeof source === "number") {
			this.id = "" + source;
		} else {
			this.id = source;
		}
	}

	get isOwner(): boolean {
		return this.id === OWNER_ID;
	}

	get isSignedUp(): boolean {
		return localStorage.getItem(this.id) !== null;
	}
	signup() {
		localStorage.setItem(this.id, ".")
	}
	get isEarlySignedUp(): boolean {
		return localStorage.getItem("early_" + this.id) !== null;
	}
	earlySignup() {
		localStorage.setItem("early_" + this.id, ".");
	}
	deleteEarlySignup() {
		localStorage.removeItem("early_" + this.id);
	}

	get description(): string {
		return localStorage.getItem("description_" + this.id);
	}
	storeDescription(msg: TelegramBot.Message) {
		const descr = msg.from.first_name +
			(msg.from.last_name ? " " + msg.from.last_name : "") +
			(msg.from.username ? " (@" + msg.from.username + ")" : "");
		logger.verbose(`Descrizione di ${this.id}: ${descr}`);
		localStorage.setItem("description_" + this.id, descr);
	}

	get santa(): User | null {
		const id = localStorage.getItem("santa_for_" + this.id);
		if (id === null)
			return null;
		else
			return new User(id);
	}
	set santa(santa: User) {
		localStorage.setItem("santa_for_" + this.id, santa.id);
	}

	get destinatario(): User | null {
		const id = localStorage.getItem("destinatario_for_" + this.id);
		if (id === null)
			return null;
		else
			return new User(id);
	}
	set destinatario(destinatario: User) {
		localStorage.setItem("destinatario_for_" + this.id, destinatario.id);
	}
}