import assert = require("assert");
import fs = require("fs");
import {localStorage} from "./storage";
import TelegramBot = require("node-telegram-bot-api");
import Sentry = require('@sentry/node');
// import graphviz = require("graphviz");
import {logger} from "./logger";
import {State, StateEnum} from "./controller/state";
import { User } from "./controller/user";

if ("SENTRY_DSN" in process.env)
	Sentry.init({ dsn: process.env.SENTRY_DSN });
else
	logger.warn("No Sentry DSN configured");
process.on("unhandledRejection", (error: Error) => logger.error("Unhandled rejection: " + error.message));

assert("BOT_TOKEN" in process.env);
const token: string = process.env.BOT_TOKEN;
assert("OWNER_ID" in process.env);
const OWNER_ID: number = Number(process.env.OWNER_ID);
assert("GROUP_ID" in process.env);
const GROUP_ID: number = Number(process.env.GROUP_ID);
const bot = new TelegramBot(token, {polling: true});

if (!fs.existsSync("./blacklist.txt"))
	throw new Error("No blacklist present!");
const blacklistArray: [string, string][] = fs.readFileSync("./blacklist.txt", "utf8")
	.split("\n")
	.filter(it => /[0-9]+ [0-9]+/.test(it))
	.map(it => it.split(" ") as [string, string]);
const blacklist: {[from: string]: string[]} = {};
for (const [from, to] of blacklistArray) {
	if (!blacklist[from])
		blacklist[from] = [to];
	else
		blacklist[from].push(to);
}
logger.info(blacklistArray.length + " blacklist entries.");

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
	return localStorage._keys.filter(it => /^(early_)?[0-9]+$/.test(it)).map(it => it.replace(/^early_/, ""));
}

bot.onText(/^\/(start|help)$/, async msg => {
	let helpText = `<b>Massimo Boldi</b> - il bot del Secret Santa di r/italy

<b>Come funziona?</b>

Ognuno di noi sarà matchato in maniera anonima e casuale con un altro utente a cui dovrà spedire un regalino di natale (non ci aspettiamo spese folli, tranquilli).

Riceverai quindi un regalo da un utente misterioso, e a tua volta ne dovrai spedire uno a un altro utente (di cui però conoscerai l'identità).

<b>Recap e vari step del progetto</b>

- Per il mese di <b>ottobre</b> sono aperte le iscrizioni e facciamo pubblicità
- Il <b>1 novembre</b> chiudono le iscrizioni e avvengono i match casuali
- Chi vuole farsi aiutare nella scelta del regalo chiede anonimamente al bot di ricevere una descrizione di sé del tizio con cui ha matchato (vietati i suggerimenti specifici di regali e oggetti: SÌ "mi piace la musica rock e sono appassionato di fai da te", NO "voglio un trapano")
- Si pensa a un regalo che rientri nel proprio budget, quel che conta è il pensiero e va bene tutto però insomma che almeno il pensiero ci sia
- Si spediscono i regali, chi vuole direttamente da Amazon, all'indirizzo reale fornito o ai vari drop point che la gente deciderà a discrezione della propria volontà di privacy
- I regali devono arrivare <b>entro il 15 dicembre</b>
- È a discrezione del donatore firmarsi nel regalo oppure no (ovviamente è vietato rivelarsi prima che il regalo sia stato ricevuto) 
- Quando si ricevono i regali si postano le foto su @nataleinindia, vogliamo tutti sapere :3 video di unwrapping apprezzati!!

<b>Lista di comandi del bot</b>

	- /help: manda questa spiegazione
	- /owo: iscriviti al Secret Santa`;
	// - /grafico: manda il grafico dei santa`;
	if (msg.from.id == OWNER_ID)
		helpText += `\n\n<b>Comandi admin</b>

	- /status: consulta lo stato di ciascun utente
	- /open: manda la conferma alle preiscrizioni e apri le iscrizioni
	- /close: annulla le preiscrizioni in sospeso
	- /match: chiudi le iscrizioni e matcha gli utenti
	- /broadcast: invia un messaggio a tutti gli utenti iscritti`;
	await reply(msg, helpText);
});

bot.onText(/^\/owo$/i, async msg => {
	const user = new User(msg.from.id);
	if (user.isSignedUp)
		return reply(msg, "Sei già iscritto al Secret Santa.");
	if (!state.preiscrizioni)
		return reply(msg, "Le iscrizioni sono chiuse!");
	if (msg.chat.id != msg.from.id)
		return reply(msg, "Mandami il comando in chat privata per iscriverti.");
	user.storeDescription(msg);
	if (user.isEarlySignedUp)
		return reply(msg, "Sei già iscritto al Secret Santa.");
	user.earlySignup();
	await reply(msg, `Ti sei iscritto al Secret Santa! A fine ottobre riceverai un messaggio per confermare o meno la tua partecipazione.

Se non l'hai già fatto manda /help per leggere le regole e il calendario.`);
	logger.info(`Nuova iscrizione: ${user.description}`);
	await bot.sendMessage(OWNER_ID, `${user.description} si è iscritto!`);
	await bot.sendMessage(GROUP_ID, `${user.description} si è iscritto!`);
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

function userHealthcheck(id: string): {success: boolean, status: string} {
	const user = new User(id);
	let success = true;
	let status = `${user.description} [${id}]:\n`;
	if (user.isSignedUp) {
		status += " - Iscritto\n";
		success = success && true;
	} else if (user.isEarlySignedUp) {
		if (state.preiscrizioni) {
			status += " - Preiscritto\n";
		} else {
			status += " - Preiscritto (<b>in attesa di conferma</b>)\n";
		}
		success = success && true;
	} else {
		status += " - <b>NON</b> iscritto\n";
		success = success && false;
	}
	const isMatched = user.destinatario !== null;
	if (isMatched) {
		status += " - Matchato\n";
		success = success && true;
	} else {
		status += " - <b>NON</b> matchato\n";
		success = success && (state.preiscrizioni || state.conferma);
	}

	if (isMatched) {
		const destinatario = user.destinatario;
		if (destinatario.description !== null) {
			status += " - Destinatario valido\n";
			success = success && true;
		} else {
			status += " - Destinatario <b>NON</b> valido\n";
			success = success && false;
		}
		if (destinatario.id === id) {
			status += " - Loop <b>NON</b> ok: destinatario di sè stesso\n";
			success = success && false;
		} else if (destinatario.destinatario.id === id) {
			status += " - Loop <b>NON</b> ok: lunghezza 2\n";
			success = success && false;
		} else {
			status += " - Loop ok\n";
			success = success && true;
		}
	}
	return {success, status: status + "\n"};
}

// Runs healthchecks on the chain
function chainHealthcheck() : {success: boolean, status: string} {
	const userIDs = getUserIds();
	let text = "";
	let _success = true;
	for (const id of userIDs) {
		const {success, status} = userHealthcheck(id);
		_success = _success && success;
		text += status;
	}
	return {success: _success, status: text};
}

bot.onText(/^\/status$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	const userIDs = getUserIds();
	const globalState = `Global state: ${state.get()}\nUser count: ${userIDs.length}\n\n`;
	const {success, status} = chainHealthcheck();
	const successString = success ? "✅ No errors\n\n" : "❌ Errors detected\n\n";
	await reply(msg, globalState + successString + status);
});

bot.onText(/^\/list$/, async msg => {
	const userIDs = getUserIds();
	const globalState = `${userIDs.length} utenti iscritti:\n\n`;
	let text = userIDs.map(id => new User(id).description).map(descr => ` - \`${descr}\``).join("\n");
	await reply(msg, globalState + text, false, {parse_mode: "Markdown"});
});

function shuffle<T>(a: T[]): T[] {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = a[i];
		a[i] = a[j];
		a[j] = tmp;
	}
	return a;
}

bot.onText(/^\/open$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (!state.preiscrizioni)
		return reply(msg, `Stato non valido: impossibile avviare le preiscrizioni in ${state.get()}`);
	for (const id of getUserIds()) {
		const user = new User(id);
		if (!user.isEarlySignedUp)
			continue;
		await bot.sendMessage(user.id, "Sta per iniziare il Secret Santa di r/italy! Vuoi confermare o annullare la tua iscrizione?", {
			reply_markup: { inline_keyboard: [[{
				text: "✅ Conferma",
				callback_data: "preiscrizione_conferma"
			}], [{
				text: "❌ Annulla, sono un cucco",
				callback_data: "preiscrizione_annulla"
			}]] }
		});
	}
	state.set(StateEnum.STATE_CONFERMA);
	await reply(msg, "Fatto!");
});

bot.onText(/^\/match$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (!state.conferma)
		return reply(msg, `Stato non valido: impossibile avviare i match in ${state.get()}`);
	let success = true;
	for (const id of getUserIds()) {
		const user = new User(id);
		if (user.isEarlySignedUp) {
			await reply(msg, `L'utente ${user.description} è ancora preiscritto! (È necessario confermare o annullare la preiscrizione)`);
			success = false;
		}
	}
	if (!success)
		return;
	/* The matching algorithm must ensure that no two people are matched with
	 * one another. This is achieved simply by shuffling the array of users and
	 * matching each user with the successor, so that the constraint doesn't
	 * fail except when there are only two users.
	*/
	let userIDs: string[];
	let shuffleSuccess = true;
	do {
		userIDs = shuffle(getUserIds());
		for (let i = 0; i < userIDs.length; i++) {
			const curID = userIDs[i];
			const nextID = userIDs[(i + 1) % userIDs.length];
			if (curID in blacklist && blacklist[curID].includes(nextID)) {
				shuffleSuccess = false;
				break;
			}
		}
	} while (!shuffleSuccess);
	for (let i = 0; i < userIDs.length; i++) {
		const santa = new User(userIDs[i]);
		const destinatario = new User(userIDs[(i + 1) % userIDs.length]);
		santa.destinatario = destinatario;
		destinatario.santa = santa;
		logger.verbose(`Match: ${santa.id} è il Santa di ${destinatario.id}`);
		await bot.sendMessage(
			santa.id,
			`Il tuo destinatario del Secret Santa è 📤 <b>${destinatario.description}</b>. Gli dovrai fare un regalo, ma lui o lei non sa che sarai tu a farglielo!

Viceversa ti è stato assegnato un 🎅 <b>Secret Santa</b>, un utente misterioso che ti farà un regalo.

Per parlare con il tuo 📤 destinatario o con il tuo 🎅 Santa, mandami semplicemente un messaggio. Puoi sempre mandare /help per consultare il calendario e le regole.`,
			{parse_mode: "HTML"}
		);
	}
	state.set(StateEnum.STATE_SENDING_GIFTS);
	await reply(msg, "Fatto. Manda /status per verificare che non ci siano problemi.");
	await reply(msg, "Quick healthcheck: " + chainHealthcheck().success);
});

bot.onText(/^\/close$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (!state.conferma)
		return reply(msg, `Stato non valido: impossibile chiudere le iscrizioni in ${state.get()}`);
	const lateUsers = [];
	for (const id of getUserIds()) {
		const user = new User(id);
		if (user.isEarlySignedUp) {
			bot.sendMessage(user.id, "La finestra per confermare la partecipazione al Secret Santa è chiusa, e la tua partecipazione è stata annullata.")
			lateUsers.push(user.description);
			user.deleteEarlySignup();
		}
	}
	await reply(msg, "Ok. Partecipazioni annullate:\n\n" + lateUsers.map(it => " - " + it).join("\n"));
	await reply(msg, "Ora puoi procedere con /match!");
});

bot.onText(/^\/broadcast$/, async msg => await reply(msg, "Sintassi: /broadcast messaggio"));
bot.onText(/^\/broadcast (.+)$/, async (msg, matches) => {
	if (msg.from.id !== OWNER_ID) return;
	const broadcast_content = matches[1];
	for (const id of getUserIds())
		await bot.sendMessage(id, broadcast_content, {parse_mode: "HTML"});
	await reply(msg, "Fatto.");
});

bot.onText(/^\/id$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	return reply(msg, "Chat ID: " + msg.chat.id);
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
		case "preiscrizione_conferma":
			if (!author.isEarlySignedUp) {
				if (author.isSignedUp)
					await bot.sendMessage(author.id, "Risulti già iscritto! Se è un bug, segnalalo in chat.");
				else
					await bot.sendMessage(author.id, "Non risulti iscritto! Se è un bug, segnalalo in chat.");
				await bot.answerCallbackQuery(query.id);
				return;
			}
			await bot.editMessageText("Hai confermato l'iscrizione al Secret Santa di r/italy! Consulta /help per il calendario e le regole del gioco.", {chat_id: query.message.chat.id, message_id: query.message.message_id});
			await bot.answerCallbackQuery(query.id);
			author.deleteEarlySignup();
			author.signup();
			await bot.sendMessage(OWNER_ID, `${author.description} ha confermato l'iscrizione.`);
			await bot.sendMessage(GROUP_ID, `${author.description} ha confermato l'iscrizione!`);
			await bot.sendMessage(author.id, "Vuoi poter essere matchato <b>con tutti gli utenti</b> o solo <b>con gli utenti che conosci</b>?", {parse_mode: "HTML", reply_markup: {inline_keyboard: [[{
				text: "Con tutti gli utenti",
				callback_data: "preiscrizione_tutti"
			}], [{
				text: "Con gli utenti che conosco",
				callback_data: "preiscrizione_conosco"
			}]]}});
			break;
		case "preiscrizione_annulla":
			if (!author.isEarlySignedUp) {
				if (author.isSignedUp)
					await bot.sendMessage(author.id, "Risulti già iscritto! Se è un bug, segnalalo in chat.");
				else
					await bot.sendMessage(author.id, "Non risulti iscritto! Se è un bug, segnalalo in chat.");
				await bot.answerCallbackQuery(query.id);
				return;
			}
			await bot.editMessageText("Hai annullato l'iscrizione al Secret Santa di r/italy!", {chat_id: query.message.chat.id, message_id: query.message.message_id});
			await bot.answerCallbackQuery(query.id);
			author.deleteEarlySignup();
			await bot.sendMessage(OWNER_ID, `${author.description} ha annullato l'iscrizione.`);
			await bot.sendMessage(GROUP_ID, `${author.description} ha annullato l'iscrizione. Cucco.`);
			break;
		case "preiscrizione_tutti":
			await bot.editMessageText("Hai selezionato di essere <b>matchato con tutti</b>! Il 1 novembre verranno fatti i match.", {parse_mode: "HTML", chat_id: query.message.chat.id, message_id: query.message.message_id});
			await bot.answerCallbackQuery(query.id);
			break;
		case "preiscrizione_conosco":
			await bot.editMessageText(`Hai selezionato di essere <b>matchato con chi conosci</b>! Contatta ${(new User(OWNER_ID)).description} per continuare.`, {parse_mode: "HTML", chat_id: query.message.chat.id, message_id: query.message.message_id});
			await bot.answerCallbackQuery(query.id);
			await bot.sendMessage(OWNER_ID, `${author.description} ha segnalato di voler essere matchato con chi conosce.`);
			break;
		default:
			logger.error("Unexpected data=" + query.data)
			await bot.answerCallbackQuery(query.id, {text: "Errore interno: query.data non riconosciuto (" + query.data + ").", show_alert: true});
			throw new Error("Unexpected data=" + query.data);
			break;
	}
});