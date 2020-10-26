export enum StateEnum {
	/* Gli utenti possono iscriversi in via preliminare. A fine ottobre col passaggio a STATE_CONFERMA riceveranno un messaggio del tipo "Sei sicuro di voler partecipare?". */
	STATE_PREISCRIZIONI = "STATE_PREISCRIZIONI",
	/* Le iscrizioni sono chiuse. Gli utenti sono chiamati a confermare di voler partecipare. Il 1 novembre con la creazione dei match si passa a STATE_SENDING_GIFTS. */
	STATE_CONFERMA = "STATE_CONFERMA",
	/* I match sono stati fatti. */
	STATE_SENDING_GIFTS = "STATE_SENDING_GIFTS"
}

export interface IState {
	// constructor();
	get(): StateEnum;
	set(s: StateEnum): void;

	preiscrizioni: boolean;
	conferma: boolean;
	sending_gifts: boolean;
}

const KEY = "global_state";

export class State implements IState {
	localStorage: any;

	constructor(localStorage) {
		this.localStorage = localStorage;
		if (this.localStorage.getItem(KEY) === null)
			this.set(StateEnum.STATE_PREISCRIZIONI);
	}

	get(): StateEnum {
		return <StateEnum>this.localStorage.getItem(KEY);
	};

	set(s: StateEnum) {
		this.localStorage.setItem(KEY, s);
	}

	get preiscrizioni(): boolean {
		return this.get() === StateEnum.STATE_PREISCRIZIONI;
	}
	get conferma(): boolean {
		return this.get() === StateEnum.STATE_CONFERMA;
	}
	get sending_gifts(): boolean {
		return this.get() === StateEnum.STATE_SENDING_GIFTS;
	}
};