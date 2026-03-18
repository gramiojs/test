import type { TelegramShippingAddress, TelegramShippingQuery } from "@gramio/types";
import { UserObject } from "./user.ts";

let lastShippingQueryId = 0;

export class ShippingQueryObject {
	public payload: TelegramShippingQuery;

	constructor(payload: Partial<TelegramShippingQuery> = {}) {
		this.payload = {
			id: String(++lastShippingQueryId),
			from: { id: 0, is_bot: false, first_name: "Unknown" },
			invoice_payload: "default_payload",
			shipping_address: {
				country_code: "US",
				state: "CA",
				city: "San Francisco",
				street_line1: "1 Market St",
				street_line2: "",
				post_code: "94105",
			},
			...payload,
		};
	}

	from(user: UserObject) {
		this.payload.from = user.payload;
		return this;
	}

	invoicePayload(payload: string) {
		this.payload.invoice_payload = payload;
		return this;
	}

	shippingAddress(address: Partial<TelegramShippingAddress>) {
		this.payload.shipping_address = {
			...this.payload.shipping_address,
			...address,
		};
		return this;
	}
}
