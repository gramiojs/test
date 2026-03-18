import type { TelegramPreCheckoutQuery } from "@gramio/types";
import { UserObject } from "./user.ts";

let lastPreCheckoutQueryId = 0;

export class PreCheckoutQueryObject {
	public payload: TelegramPreCheckoutQuery;

	constructor(payload: Partial<TelegramPreCheckoutQuery> = {}) {
		this.payload = {
			id: String(++lastPreCheckoutQueryId),
			from: { id: 0, is_bot: false, first_name: "Unknown" },
			currency: "XTR",
			total_amount: 1,
			invoice_payload: "default_payload",
			...payload,
		};
	}

	from(user: UserObject) {
		this.payload.from = user.payload;
		return this;
	}

	currency(currency: TelegramPreCheckoutQuery["currency"]) {
		this.payload.currency = currency;
		return this;
	}

	totalAmount(amount: number) {
		this.payload.total_amount = amount;
		return this;
	}

	invoicePayload(payload: string) {
		this.payload.invoice_payload = payload;
		return this;
	}

	shippingOptionId(id: string) {
		this.payload.shipping_option_id = id;
		return this;
	}

	orderInfo(info: TelegramPreCheckoutQuery["order_info"]) {
		this.payload.order_info = info;
		return this;
	}
}
