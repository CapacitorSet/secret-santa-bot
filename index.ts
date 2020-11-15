import assert = require("assert");
import {localStorage} from "./storage";
import TelegramBot = require("node-telegram-bot-api");
import Sentry = require('@sentry/node');
import {logger} from "./logger";
import {State, StateEnum} from "./controller/state";
import User, { allUserIds, allUsers } from "./controller/user";
import createMatches from "./matching";

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

const state = new State(localStorage);

function reply(msg: TelegramBot.Message, text: string, withHTML: boolean = true, others?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
	let options: TelegramBot.SendMessageOptions = {reply_to_message_id: msg.message_id};
	if (withHTML)
		options.parse_mode = "HTML";
	if (others)
		options = Object.assign(options, others);
	return bot.sendMessage(msg.chat.id, text, options);
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

function userHealthcheck(user: User): {success: boolean, status: string} {
	try {
		let success = true;
		let status = `${user.description} [${user.id}]:\n`;
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
			if (destinatario.id === user.id) {
				status += " - Loop <b>NON</b> ok: destinatario di sè stesso\n";
				success = success && false;
			} else if (destinatario.destinatario.id === user.id) {
				status += " - Loop <b>NON</b> ok: lunghezza 2\n";
				success = success && false;
			} else {
				status += " - Loop ok\n";
				success = success && true;
			}
		}
		return {success, status: status + "\n"};
	} catch (e) {
		return {success: false, status: "An error occurred: " + e + "\n"};
	}
}

// Runs healthchecks on the chain
function chainHealthcheck() : {success: boolean, status: string} {
	const statusInfo = allUsers().map(userHealthcheck);
	return {
		success: statusInfo.every(({success}) => success),
		status: statusInfo.map(({status}) => status).join("")
	};
}

bot.onText(/^\/status$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	const userIDs = allUserIds();
	const globalState = `Global state: ${state.get()}\nUser count: ${userIDs.length}\nChain count: ${matches.length}\n\n`;
	let {success, status} = chainHealthcheck();
	if (state.sending_gifts)
		success = success || (userIDs.length == matches.length)
	const successString = success ? "✅ No errors\n\n" : "❌ Errors detected\n\n";
	await reply(msg, globalState + successString + status);
});

bot.onText(/^\/list$/, async msg => {
	const users = allUsers();
	const globalState = `${users.length} utenti iscritti:\n\n`;
	let text = users.map(user => user.description).map(descr => ` - \`${descr}\``).join("\n");
	await reply(msg, globalState + text, false, {parse_mode: "Markdown"});
});

bot.onText(/^\/open$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (!state.preiscrizioni)
		return reply(msg, `Stato non valido: impossibile avviare le preiscrizioni in ${state.get()}`);
	for (const user of allUsers()) {
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

let matches: string[] = [];

bot.onText(/^\/match$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (!state.conferma)
		return reply(msg, `Stato non valido: impossibile avviare i match in ${state.get()}`);
	let success = true;
	for (const user of allUsers()) {
		if (user.isEarlySignedUp) {
			await reply(msg, `L'utente ${user.description} è ancora preiscritto! (È necessario confermare o annullare la preiscrizione)`);
			success = false;
		}
	}
	if (!success)
		return;
	
	matches = await createMatches();

	for (let i = 0; i < matches.length; i++) {
		const santa = new User(matches[i]);
		const destinatario = new User(matches[(i + 1) % matches.length]);
		santa.destinatario = destinatario;
		destinatario.santa = santa;
		logger.verbose(`Match: ${santa.description} [${santa.id}] è il Santa di ${destinatario.description} [${destinatario.id}]`);
	}

	// Must set sending_gifts to healthcheck correctly
	state.set(StateEnum.STATE_SENDING_GIFTS);
	const health_success = chainHealthcheck().success;

	if (!health_success) {
		await reply(msg, "Quick healthcheck: false! Non sono stati effettuati i match. Manda /status per verificare qual è l'errore.");
		return;
	}
	await reply(msg, "Quick healthcheck: true. Puoi procedere a /match_send, o verificare i match con /status.");
});

bot.onText(/^\/match_send$/, async msg => {
	if (matches.length == 0) {
		await reply(msg, "I match non sono ancora stati fatti con /match!");
		return;
	}

	const promises: Promise<any>[] = [];
	for (let i = 0; i < matches.length; i++) {
		const user = new User(matches[i]);
		promises.push(bot.sendMessage(
			user.id,
			`Il tuo destinatario del Secret Santa è 📤 <b>${user.destinatario.description}</b>. Gli dovrai fare un regalo, ma lui o lei non sa che sarai tu a farglielo!

Viceversa ti è stato assegnato un 🎅 <b>Secret Santa</b>, un utente misterioso che ti farà un regalo.

Per parlare con il tuo 📤 destinatario o con il tuo 🎅 Santa, mandami semplicemente un messaggio. Puoi sempre mandare /help per consultare il calendario e le regole.`,
			{parse_mode: "HTML"}
		));
	}


	try {
		await Promise.all(promises);
		state.set(StateEnum.STATE_SENDING_GIFTS);
		await reply(msg, "Fatto. Manda /status per verificare che non ci siano problemi.");
		await reply(msg, "Quick healthcheck: " + chainHealthcheck().success);
	} catch (e) {
		await reply(msg, "Si è verificato un errore: " + e);
	}
	
});

bot.onText(/^\/close$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	if (!state.conferma)
		return reply(msg, `Stato non valido: impossibile chiudere le iscrizioni in ${state.get()}`);
	const lateUsers = [];
	for (const user of allUsers()) {
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
	const promises = allUserIds().map(id => bot.sendMessage(id, broadcast_content, {parse_mode: "HTML"}));
	try {
		await Promise.all(promises);
		await reply(msg, "Fatto.");
	} catch (e) {
		await reply(msg, "Si è verificato un errore: " + e);
	}
});

bot.onText(/^\/id$/, async msg => {
	if (msg.from.id !== OWNER_ID) return;
	return reply(msg, "Chat ID: " + msg.chat.id);
});

const messageQueue: {[user: number]: string} = {}
const picsQueue: {[user: number]: string} = {}

bot.on("text", msg => {
	if (msg.chat.type != "private")
		return;
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
	if (msg.chat.type != "private")
		return;
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
