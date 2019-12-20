import assert = require("assert");
import fs = require("fs");
import {localStorage} from "./storage";
import TelegramBot = require("node-telegram-bot-api");
import graphviz = require("graphviz");
import {logger} from "./logger";
import {State, StateEnum} from "./controller/state";
import { User } from "./controller/user";

process.on("unhandledRejection", (error: Error) => logger.error("Unhandled rejection: " + error.message));

assert("BOT_TOKEN" in process.env);
const token: string = process.env.BOT_TOKEN;
assert("OWNER_ID" in process.env);
const OWNER_ID: number = Number(process.env.OWNER_ID);
const bot = new TelegramBot(token, {polling: true});

const state = new State(localStorage);

function reply(msg: TelegramBot.Message, text: string, withHTML: boolean = true, others?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
	let options: TelegramBot.SendMessageOptions = {reply_to_message_id: msg.message_id};
	if (withHTML)
		options.parse_mode = "HTML";
	if (others)
		options = Object.assign(options, others);
	return bot.sendMessage(msg.chat.id, text, options);
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
	- /broadcast: invia un messaggio a tutti gli utenti iscritti
	- /dump: fai il dump delle coppie (in un formato valido per <code>blacklist.txt</code>)`;
	await reply(msg, helpText);
});

bot.onText(/^\/owo$/i, async msg => {
	const user = new User(msg.from.id);
	if (user.isSignedUp)
		return reply(msg, "Sei già iscritto al Secret Santa.");
	if (!state.open)
		return reply(msg, "Le iscrizioni sono chiuse!");
	if (msg.chat.id != msg.from.id)
		return reply(msg, "Mandami il comando in chat privata per iscriverti.");
	user.signup();
	user.storeDescription(msg);
	await reply(msg, "Ti sei iscritto al Secret Santa!");
	logger.info(`Nuova iscrizione: ${user.description}`);
	return bot.sendMessage(OWNER_ID, `${user.description} si è iscritto!`);
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
	const globalState = `Global state: ${state.get()}\nUser count: ${userIDs.length}`;
	const userStatus = userIDs.map(_id => {
		const user = new User(_id);
		let descrizione = `${user.description} [${_id}]:\n`;
		descrizione += user.isSignedUp ? " - Iscritto\n" : " - <b>NON</b> iscritto\n";
		const isMatched = user.destinatario !== null;
		descrizione += isMatched ? " - Matchato\n" : " - <b>NON</b> matchato\n";
		if (isMatched) {
			const destinatario = user.destinatario;
			descrizione += (destinatario.description !== null)
				? " - Destinatario valido\n"
				: " - Destinatario <b>NON</b> valido\n";
			descrizione += (destinatario.description !== _id)
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
	// todo: aggiungere il supporto a blacklist.txt
	if (msg.from.id !== OWNER_ID) return;
	if (!state.open)
		return reply(msg, `Stato non valido: impossibile avviare i match in ${state.get()}`);
	/* The matching algorithm must ensure that no two people are matched with
	 * one another. This is achieved simply by shuffling the array of users and
	 * matching each user with the successor, so that the constraint doesn't
	 * fail except when there are only two users.
	*/
	const userIDs: string[] = shuffle(getUserIds());
	for (let i = 0; i < userIDs.length; i++) {
		const santa = new User(userIDs[i]);
		const destinatario = new User(userIDs[(i + 1) % userIDs.length]);
		santa.destinatario = destinatario;
		destinatario.santa = santa;
		logger.verbose(`Match: ${santa} è il Santa di ${destinatario.id}`);
		await bot.sendMessage(
			santa.id,
			`Il tuo destinatario del Secret Santa è 📤 <b>${destinatario.description}</b>. Gli dovrai fare un regalo, ma lui o lei non sa che sarai tu a farglielo!

Viceversa ti è stato assegnato un 🎅 <b>Secret Santa</b>, un utente misterioso che ti farà un regalo.

Per parlare con il tuo 📤 destinatario o con il tuo 🎅 Santa, mandami semplicemente un messaggio.`,
			{parse_mode: "HTML"}
		);
	}
	state.set(StateEnum.STATE_SENDING_GIFTS);
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

bot.onText(/^\/dump$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	await reply(msg, getUserIds().map(santa => {
		const destinatario = new User(santa).destinatario;
		return santa + ";" + destinatario;
	}).join("\n"));
});

const messageQueue: {[user: number]: string} = {}
const picsQueue: {[user: number]: string} = {}

bot.on("text", msg => {
	logger.debug(msg.from.id + ": " + msg.text);
	if (/^\//.test(msg.text)) return;
	if (!state.sending_gifts) return;
	const author = new User(msg.from.id);
	messageQueue[author.id] = msg.text;
	const destinatario = author.destinatario;
	return reply(msg, `Vuoi mandare il messaggio al tuo 🎅 Santa (l'utente misterioso che ti manderà il regalo) o al tuo destinatario 📤 ${destinatario.description}?`, true, {
		reply_markup: { inline_keyboard: [[{
			text: "🎅 Santa",
			callback_data: "santa"
		}], [{
			text: "📤 " + destinatario.description,
			callback_data: "destinatario"
		}]] }
	});
});

bot.on("photo", async msg => {
	if (!("photo" in msg)) return;
	if (!state.sending_gifts) return;
	const author = new User(msg.from.id);
	picsQueue[author.id] = msg.photo[msg.photo.length - 1].file_id;
	messageQueue[author.id] = msg.caption || "";
	const destinatario = author.destinatario;
	await reply(msg, `Vuoi mandare il messaggio al tuo 🎅 Santa (l'utente misterioso che ti manderà il regalo) o al tuo destinatario 📤 ${destinatario.description}?`, true, {
		reply_markup: { inline_keyboard: [[{
			text: "🎅 Santa",
			callback_data: "santa_pic"
		}], [{
			text: "📤 " + destinatario.description,
			callback_data: "destinatario_pic"
		}]] }
	});
});

bot.on("callback_query", async query => {
	logger.debug(`Callback query: data=${query.data}, from=${query.from.id}`);
	const author = new User(query.from.id);
	switch (query.data) {
		case "santa":
			await bot.sendMessage(author.santa.id, `Messaggio dal tuo 📤 destinatario ${author.description}:\n\n${messageQueue[query.from.id]}`);
			logger.debug(`Sent ${messageQueue[query.from.id]} to ${author.santa.id}`);
			// delete messageQueue[query.from.id];
			await bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 🎅 Santa."});
			await bot.editMessageText("Inviato al tuo 🎅 Santa.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		case "destinatario":
			await bot.sendMessage(author.destinatario.id, "Messaggio dal tuo 🎅 Santa:\n\n" + messageQueue[query.from.id]);
			logger.debug(`Sent ${messageQueue[query.from.id]} to ${author.destinatario.id}`);
			// delete messageQueue[query.from.id];
			await bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 📤 destinatario."});
			await bot.editMessageText("Inviato al tuo 📤 destinatario.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		case "santa_pic":
			await bot.sendMessage(author.santa.id, `Messaggio dal tuo 📤 destinatario ${author.description}:`);
			await bot.sendPhoto(author.santa.id, picsQueue[query.from.id], {
				caption: messageQueue[query.from.id]
			});
			logger.debug(`Sent ${messageQueue[query.from.id]} (with pic) to ${author.santa.id}`);
			// delete messageQueue[query.from.id];
			bot.answerCallbackQuery(query.id, {text: "Inviato al tuo 🎅 Santa."});
			bot.editMessageText("Inviato al tuo 🎅 Santa.", {chat_id: query.message.chat.id, message_id: query.message.message_id})
			break;
		case "destinatario_pic":
			await bot.sendMessage(author.destinatario.id, "Messaggio dal tuo 🎅 Santa:");
			await bot.sendPhoto(author.destinatario.id, picsQueue[query.from.id], {
				caption: messageQueue[query.from.id]
			});
			logger.debug(`Sent ${messageQueue[query.from.id]} (with pic) to ${author.destinatario.id}`);
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