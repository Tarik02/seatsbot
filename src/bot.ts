import Telegraf, {ContextMessageUpdate, Markup} from 'telegraf';
import _ from 'lodash';

import * as Seats from './seats';

class SilentError extends Error {}

const sendSomethingWentWrong = async (ctx: ContextMessageUpdate, info?: string): Promise<never> => {
	if (info !== undefined) {
		await ctx.reply(':( ' + info);
	} else {
		await ctx.reply(':( Щось пішло не так...');
	}

	throw new SilentError();
};

const getCommandBody = async (ctx: ContextMessageUpdate): Promise<string> => {
	if (!ctx.message || !ctx.message.text) {
		return await sendSomethingWentWrong(ctx);
	}

	return ctx.message.text.replace(/^[^\s]*\s*/, '');
};

const getButtonsPerRowCount = (totalCount: number): number => {
	// max 5 buttons per row
	const minRows = Math.ceil(totalCount / 5);

	// would be cool to have a square set of buttons
	const goodRows = Math.floor(Math.sqrt(totalCount));

	return Math.max(
		minRows,
		goodRows,
	);
};

const setMessage = async (
	ctx: ContextMessageUpdate,
	message: Seats.SeatsMessage,
	create: boolean = false,
): Promise<void> => {
	const buttons = Seats.getButtons(message);
	const markup = Markup.inlineKeyboard(
		_.chunk(buttons, getButtonsPerRowCount(buttons.length)).concat([
			[Markup.callbackButton('Скасувати вибір', 'leave')],
		]),
	);
	markup.oneTime(false).resize(true);

	if (create) {
		await ctx.reply(
			Seats.show(message),
			{
				reply_to_message_id: ctx.message!.message_id,
				reply_markup: markup,
			},
		);
	} else {
		await ctx.telegram.editMessageText(
			ctx.chat!.id,
			ctx.callbackQuery!.message!.message_id,
			void 0,
			Seats.show(message),
			{
				reply_to_message_id: ctx.callbackQuery!.message!.reply_to_message!.message_id,
				reply_markup: markup,
			},
		);
	}
};

export const main = async (bot: Telegraf<ContextMessageUpdate>) => {
	const me = await bot.telegram.getMe();
	bot.options.username = me.username;

	bot.catch(console.error);

	bot.use(async (_, next) => {
		try {
			await next!();
		} catch (e) {
			if (!(e instanceof SilentError)) {
				throw e;
			}
		}
	});

	bot.command('select', async (ctx): Promise<void> => {
		const body = await getCommandBody(ctx);

		const match = body.match(/(\d+)(?:|\s+(.*))/);
		if (!match) {
			return await sendSomethingWentWrong(ctx);
		}

		const message = Seats.create(match[2], Number(match[1]));

		await setMessage(ctx, message, true);
	});

	bot.action(/^enter:(\d+)$/, async ctx => {
		const i = Number(ctx.match![1]);
		const query = ctx.callbackQuery!;
		const message = Seats.parse(query.message!.text!);
		const user = '@' + query.from.username;

		if (message === undefined) {
			await ctx.answerCbQuery(':( Щось пішло не так...');
			return;
		}

		if (Seats.has(message, user)) {
			await ctx.answerCbQuery(':( Ви вже вибрали один із варіантів.');
			return;
		}

		if (message.seats[i] !== undefined) {
			await ctx.answerCbQuery(':( Цей варіант вже вибраний кимось іншим.');
		}

		message.seats[i] = user;

		await Promise.all([
			ctx.answerCbQuery(':) Ok'),
			setMessage(ctx, message),
		]);
	});

	bot.action('leave', async ctx => {
		const query = ctx.callbackQuery!;
		const message = Seats.parse(query.message!.text!);
		const user = '@' + query.from.username;

		if (message === undefined) {
			await ctx.answerCbQuery(':( Щось пішло не так...');
			return;
		}

		if (!Seats.has(message, user)) {
			await ctx.answerCbQuery(':( Ви не вибрали жоден із варіантів.');
			return;
		}

		const i = message.seats.indexOf(user);
		message.seats[i] = undefined;

		await Promise.all([
			ctx.answerCbQuery(':) Ok'),
			setMessage(ctx, message),
		]);
	});
};