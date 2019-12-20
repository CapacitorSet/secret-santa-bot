export enum StateEnum {
	STATE_OPEN = "STATE_OPEN",
	STATE_SENDING_GIFTS = "STATE_SENDING_GIFTS"
}

export interface IState {
	// constructor();
	get(): StateEnum;
	set(s: StateEnum): void;

	open: boolean;
	sending_gifts: boolean;
}

const KEY = "global_state";

export class State implements IState {
	localStorage: any;

	constructor(localStorage) {
		this.localStorage = localStorage;
		if (this.localStorage.getItem(KEY) === null)
			this.set(StateEnum.STATE_OPEN);
	}

	get(): StateEnum {
		return <StateEnum>this.localStorage.getItem(KEY);
	};

	set(s: StateEnum) {
		this.localStorage.setItem(KEY, s);
	}

	get open(): boolean {
		return this.get() === StateEnum.STATE_OPEN;
	}
	get sending_gifts(): boolean {
		return this.get() === StateEnum.STATE_SENDING_GIFTS;
	}
};