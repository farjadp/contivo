import { z } from 'zod';

export const GetBalanceResponse = z.object({
  balance: z.number().int(),
});
export type GetBalanceResponse = z.infer<typeof GetBalanceResponse>;
