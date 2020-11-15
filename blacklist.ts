import fs = require("fs");
import User from "./controller/user";
import {logger} from "./logger";

function lineIsComment(line: string) {
    return /^#/.test(line);
}
function lineIsEntry(line: string) {
    return /^[0-9]+ [0-9]+$/.test(line);
}

export default class Blacklist {
    _blacklist: {[santa: string]: string[]};

    healthcheck(): void {
        const userSet = new Set<string>();
        for (const santa in this._blacklist) {
            userSet.add(santa);
            for (const destinatario of this._blacklist[santa]) {
                userSet.add(destinatario);                
            }
        }
        for (const user of userSet) {
            if ((new User(user)).description == null)
                logger.warn(`L'utente ${user} nella blacklist non ha una descrizione, probabilmente è errato!`);
        }
    }

    constructor(filename = "./blacklist.txt") {
        if (!fs.existsSync(filename))
            throw new Error("No blacklist present!");
        const lines = fs.readFileSync(filename, "utf8").split("\n");
        this._blacklist = {};
        let numEntries = 0;
        for (const line of lines) {
            if (lineIsComment(line) || line == "")
                continue;
            if (!lineIsEntry(line))
                throw new Error("Expected entry or comment, found " + JSON.stringify(line));
            const [santa, destinatario] = line.split(" ");
            if (!this._blacklist[santa])
                this._blacklist[santa] = [destinatario];
            else
                this._blacklist[santa].push(destinatario);
            numEntries++;
        }
        logger.info(`${numEntries} blacklist entries.`);
        this.healthcheck();
    }

    isBlacklisted(santa: string, destinatario: string) {
        return (santa in this._blacklist) && (this._blacklist[santa].includes(destinatario));
    }
}