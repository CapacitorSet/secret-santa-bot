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

	get santa(): User {
		const id = localStorage.getItem("santa_for_" + this.id);
		return new User(id);
	}
	set santa(santa: User) {
		localStorage.setItem("santa_for_", santa.id);
	}

	get destinatario(): User {
		const id = localStorage.getItem("destinatario_for_" + this.id);
		return new User(id);
	}
	set destinatario(destinatario: User) {
		localStorage.setItem("destinatario_for_", destinatario.id);
	}
}