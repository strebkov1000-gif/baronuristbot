import { prisma } from './database';

/**
 * Генерирует уникальный MEMO для платежа
 * Формат: ORD-XXXXXX (6 цифр)
 */
export async function generatePaymentMemo(): Promise<string> {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Генерируем случайное 6-значное число (100000-999999)
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const memo = `ORD-${randomNum}`;

    // Проверяем уникальность в БД
    const existing = await prisma.payment.findUnique({
      where: { paymentMemo: memo }
    });

    if (!existing) {
      return memo;
    }
  }

  // Fallback: используем timestamp (крайне маловероятно)
  const timestamp = Date.now().toString().slice(-6);
  return `ORD-${timestamp}`;
}
