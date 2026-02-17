import type { TelegramInlineQuery } from "@gramio/types";
import { UserObject } from "./user.ts";

let lastInlineQueryId = 0;

export class InlineQueryObject {
	public payload: TelegramInlineQuery;

	constructor(payload: Partial<TelegramInlineQuery> = {}) {
		this.payload = {
			id: String(++lastInlineQueryId),
			from: { id: 0, is_bot: false, first_name: "Unknown" },
			query: "",
			offset: "",
			...payload,
		};
	}

	from(user: UserObject) {
		this.payload.from = user.payload;
		return this;
	}

	query(query: string) {
		this.payload.query = query;
		return this;
	}

	offset(offset: string) {
		this.payload.offset = offset;
		return this;
	}
}
