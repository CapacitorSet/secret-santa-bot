import assert = require("assert");
import fs = require("fs");
const LocalStorage = require("node-localstorage").LocalStorage;
const localStorage : {
	_keys: string[],
	getItem(key: string): string,
	setItem(key: string, value: string): void,
} = new LocalStorage("./localstorage/");
import TelegramBot = require("node-telegram-bot-api");
import graphviz = require("graphviz");
import winston = require("winston");

const logger = winston.createLogger({
	level: "debug",
	format: winston.format.simple(),
	transports: [
		new winston.transports.File({ filename: "error.log", level: "error" }),
		new winston.transports.Console({ format: winston.format.simple() })
	]
});

process.on("unhandledRejection", (error: Error) => logger.error("Unhandled rejection: " + error.message));

assert("BOT_TOKEN" in process.env);
const token: string = process.env.BOT_TOKEN;
assert("OWNER_ID" in process.env);
const OWNER_ID: number = Number(process.env.OWNER_ID);
const bot = new TelegramBot(token, {polling: true});

const STATE_OPEN = "STATE_OPEN",
	STATE_SENDING_GIFTS = "STATE_SENDING_GIFTS";
if (localStorage.getItem("global_state") === null)
	localStorage.setItem("global_state", STATE_OPEN);

function getState(): string {
	return localStorage.getItem("global_state");
}
function setState(state: "STATE_OPEN" | "STATE_SENDING_GIFTS"): void {
	localStorage.setItem("global_state", state);
}

function reply(msg: TelegramBot.Message, text: string, withHTML: boolean = true, others?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
	let options: TelegramBot.SendMessageOptions = {reply_to_message_id: msg.message_id};
	if (withHTML)
		options.parse_mode = "HTML";
	if (others)
		options = Object.assign(options, others);
	return bot.sendMessage(msg.chat.id, text, options);
}

function signUp(id: number): void {
	localStorage.setItem("" + id, ".");
}
function isSignedUp(id: number): boolean {
	return localStorage.getItem("" + id) !== null;
}

function setDescription(authorId: number, msg: TelegramBot.Message): void {
	const descr = msg.from.first_name +
		(msg.from.last_name ? " " + msg.from.last_name : "") +
		(msg.from.username ? " (@" + msg.from.username + ")" : "");
	logger.verbose(`Descrizione di ${authorId}: ${descr}`);
	localStorage.setItem("description_" + authorId, descr);
}
function getDescription(authorId: number): string {
	return localStorage.getItem("description_" + authorId);
}

function setSanta(destinatario: number, santa: number): void {
	localStorage.setItem("santa_for_" + destinatario, "" + santa);
}
function getSanta(destinatario: number): string {
	return localStorage.getItem("santa_for_" + destinatario);
}
function setDestinatario(santa: number, destinatario: number): void {
	localStorage.setItem("destinatario_for_" + santa, "" + destinatario);
}
function getDestinatario(santa: number): string {
	return localStorage.getItem("destinatario_for_" + santa);
}

function getUserIds(): string[] {
	return localStorage._keys.filter(it => /^[0-9]+$/.test(it));
}

bot.onText(/^\/(start|help)$/, async msg => {
	let helpText = `<b>Massimo Boldi</b> - il bot del Secret Santa di r/italy

Lista di comandi:

	- /help: manda la lista di comandi
	- /owo: iscriviti al Secret Santa`;
	// - /grafico: manda il grafico dei santa`;
	if (msg.from.id == OWNER_ID)
		helpText += `\n\nComandi admin:

	- /status: consulta lo stato di ciascun utente
	- /match: chiudi le iscrizioni e matcha gli utenti
	- /broadcast: invia un messaggio a tutti gli utenti iscritti`;
	await reply(msg, helpText);
});

bot.onText(/^\/owo$/i, async msg => {
	if (isSignedUp(msg.from.id))
		return reply(msg, "Sei già iscritto al Secret Santa.");
	if (getState() != STATE_OPEN)
		return reply(msg, "Le iscrizioni sono chiuse!");
	if (msg.chat.id != msg.from.id)
		return reply(msg, "Mandami il comando in chat privata per iscriverti.");
	signUp(msg.from.id);
	setDescription(msg.from.id, msg);
	await reply(msg, "Ti sei iscritto al Secret Santa!");
	logger.info("Nuova iscrizione: " + getDescription(msg.from.id));
	return bot.sendMessage(OWNER_ID, getDescription(msg.from.id) + " si è iscritto!");
});

/*
Todo: scriverlo, ma in base alle guess di ciascuno su chi sia il proprio Santa
bot.onText(/^\/grafico$/, async msg => {
	const graph = graphviz.digraph("G");
	for (const _id of getUserIds()) {
		const id = Number(_id);
		graph.addNode(_id, {label: getDescription(id)});
		const destinatario = getDestinatario(id);
		if (destinatario !== null)
			graph.addEdge(_id, destinatario);
	}
	graph.render({
		type: "png",
		use: "neato"
	 }, "/tmp/santa.png");
	await bot.sendPhoto(msg.chat.id, fs.createReadStream("/tmp/santa.png"), {
		reply_to_message_id: msg.message_id
	});
});
*/

bot.onText(/^\/status$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	const userIDs = getUserIds();
	const globalState = `Global state: ${getState()}\nUser count: ${userIDs.length}`;
	const userStatus = userIDs.map(_id => {
		const id = Number(_id);
		let descrizione = getDescription(Number(id)) + " [" + _id + "]:\n";
		descrizione += isSignedUp(id) ? " - Iscritto\n" : " - <b>NON</b> iscritto\n";
		const isMatched = getDestinatario(id) !== null;
		descrizione += isMatched ? " - Matchato\n" : " - <b>NON</b> matchato\n";
		if (isMatched) {
			const destinatario = Number(getDestinatario(id));
			descrizione += (getDescription(destinatario) !== null)
				? " - Destinatario valido\n"
				: " - Destinatario <b>NON</b> valido\n";
			descrizione += (getDestinatario(destinatario) !== _id)
				? " - Loop ok\n"
				: " - Loop <b>NON</b> ok\n";
		}
		return descrizione;
	}).join("\n");
	await reply(msg, globalState + "\n\n" + userStatus);
});

function shuffle<T>(a: T[]): T[] {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const x = a[i];
		a[i] = a[j];
		a[j] = x;
	}
	return a;
}

bot.onText(/^\/match$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (getState() != STATE_OPEN)
		return reply(msg, `Stato non valido: impossibile avviare i match in ${getState()}`);
	/* The matching algorithm must ensure that no two people are matched with
	 * one another. This is achieved simply by shuffling the array of users and
	 * matching each user with the successor, so that the constraint doesn't
	 * fail except when there are only two users.
	*/
	const userIDs: string[] = shuffle(getUserIds());
	for (let i = 0; i < userIDs.length; i++) {
		const santa = Number(userIDs[i]);
		const destinatario = Number(userIDs[(i + 1) % userIDs.length]);
		setDestinatario(santa, destinatario);
		setSanta(destinatario, santa);
		logger.verbose(`Match: ${santa} è il Santa di ${destinatario}`);
		await bot.sendMessage(
			santa,
			`Il tuo destinatario del Secret Santa è 📤 <b>${getDescription(destinatario)}</b>. Gli dovrai fare un regalo, ma lui o lei non sa che sarai tu a farglielo!

Viceversa ti è stato assegnato un 🎅 <b>Secret Santa</b>, un utente misterioso che ti farà un regalo.

Per parlare con il tuo 📤 destinatario o con il tuo 🎅 Santa, mandami semplicemente un messaggio.`,
			{parse_mode: "HTML"}
		);
	}
	setState(STATE_SENDING_GIFTS);
	await reply(msg, "Fatto. Manda /status per verificare che non ci siano problemi.");
});

bot.onText(/^\/broadcast$/, async msg => await reply(msg, "Sintassi: /broadcast messaggio"));
bot.onText(/^\/broadcast (.+)$/, async (msg, matches) => {
	if (msg.from.id !== OWNER_ID) return;
	const broadcast_content = matches[1];
	for (const id of getUserIds())
		await bot.sendMessage(id, broadcast_content, {parse_mode: "HTML"});
	await reply(msg, "Fatto.");
});

const messageQueue: {[user: number]: string} = {}
const picsQueue: {[user: number]: string} = {}

bot.on("text", msg => {
	logger.debug(msg.from.id + ": " + msg.text);
	if (/^\//.test(msg.text)) return;
	if (getState() != STATE_SENDING_GIFTS) return;
	messageQueue[msg.from.id] = msg.text;
	const descrDestinatario = getDescription(Number(getDestinatario(msg.from.id)));
	return reply(msg, `Vuoi mandare il messaggio al tuo 🎅 Santa (l'utente misterioso che ti manderà il regalo) o al tuo destinatario 📤 ${descrDestinatario}?`, true, {
		reply_markup: { inline_keyboard: [[{
			text: "🎅 Santa",
			callback_data: "santa"
		}], [{
			text: "📤 " + descrDestinatario,
			callback_data: "destinatario"
		}]] }
	});
});

bot.on("photo", async msg => {
	if (!("photo" in msg)) return;
	if (getState() != STATE_SENDING_GIFTS) return;
	picsQueue[msg.from.id] = msg.photo[msg.photo.length - 1].file_id;
	messageQueue[msg.from.id] = msg.caption || "";
	const descrDestinatario = getDescription(Number(getDestinatario(msg.from.id)));
	await reply(msg, `Vuoi mandare il messaggio al tuo 🎅 Santa (l'utente misterioso che ti manderà il regalo) o al tuo destinatario 📤 ${descrDestinatario}?`, true, {
		reply_markup: { inline_keyboard: [[{
			text: "🎅 Santa",
			callback_data: "santa_pic"
		}], [{
			text: "📤 " + descrDestinatario,
			callback_data: "destinatario_pic"
		}]] }
	});
});

bot.on("callback_query", async query => {
	logger.debug(`Callback query: data=${query.data}, from=${query.from.id}`);
	switch (query.data) {
		case "santa":
			await bot.sendMessage(getSanta(query.from.id), `Messaggio dal tuo 📤 destinatario ${getDescription(query.from.id)}:\n\n${messageQueue[query.from.id]}`);
			logger.debug(`Sent ${messageQueue[query.from.id]} to ${getSanta(query.from.id)}`);
			// delete messageQueue[query.from.id];
			await bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 🎅 Santa."});
			await bot.editMessageText("Inviato al tuo 🎅 Santa.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		case "destinatario":
			await bot.sendMessage(getDestinatario(query.from.id), "Messaggio dal tuo 🎅 Santa:\n\n" + messageQueue[query.from.id]);
			logger.debug(`Sent ${messageQueue[query.from.id]} to ${getDestinatario(query.from.id)}`);
			// delete messageQueue[query.from.id];
			await bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 📤 destinatario."});
			await bot.editMessageText("Inviato al tuo 📤 destinatario.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		case "santa_pic":
			await bot.sendMessage(getSanta(query.from.id), `Messaggio dal tuo 📤 destinatario ${getDescription(query.from.id)}:`);
			await bot.sendPhoto(getSanta(query.from.id), picsQueue[query.from.id], {
				caption: messageQueue[query.from.id]
			});
			logger.debug(`Sent ${messageQueue[query.from.id]} (with pic) to ${getSanta(query.from.id)}`);
			// delete messageQueue[query.from.id];
			bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 🎅 Santa."});
			bot.editMessageText("Inviato al tuo 🎅 Santa.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		case "destinatario_pic":
			await bot.sendMessage(getDestinatario(query.from.id), "Messaggio dal tuo 🎅 Santa:");
			await bot.sendPhoto(getDestinatario(query.from.id), picsQueue[query.from.id], {
				caption: messageQueue[query.from.id]
			});
			logger.debug(`Sent ${messageQueue[query.from.id]} (with pic) to ${getDestinatario(query.from.id)}`);
			// delete messageQueue[query.from.id];
			await bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 📤 destinatario."});
			await bot.editMessageText("Inviato al tuo 📤 destinatario.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		default:
			logger.error("Unexpected data=" + query.data)
			await bot.answerCallbackQuery(query.id, {text: "Errore interno: query.data non riconosciuto (" + query.data + ").", show_alert: true});
			break;
	}
});