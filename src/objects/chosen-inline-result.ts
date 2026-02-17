import type { TelegramChosenInlineResult } from "@gramio/types";
import { UserObject } from "./user.ts";

export class ChosenInlineResultObject {
	public payload: TelegramChosenInlineResult;

	constructor(payload: Partial<TelegramChosenInlineResult> = {}) {
		this.payload = {
			result_id: "",
			from: { id: 0, is_bot: false, first_name: "Unknown" },
			query: "",
			...payload,
		};
	}

	from(user: UserObject) {
		this.payload.from = user.payload;
		return this;
	}

	resultId(id: string) {
		this.payload.result_id = id;
		return this;
	}

	query(query: string) {
		this.payload.query = query;
		return this;
	}
}
