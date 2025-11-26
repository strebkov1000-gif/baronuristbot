import { User } from '@prisma/client';
import { prisma } from './database';

export interface CreateUserParams {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  referralCode?: string; // Реферальный код пригласившего
}

/**
 * Генерирует уникальный реферальный код
 */
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Находит или создаёт пользователя
 */
export async function findOrCreateUser(params: CreateUserParams): Promise<User> {
  const { telegramId, username, firstName, lastName, referralCode } = params;

  // Проверяем, существует ли пользователь
  let user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) }
  });

  if (!user) {
    // Ищем пригласившего по реферальному коду
    let referrerId: string | undefined;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode }
      });
      if (referrer) {
        referrerId = referrer.id;
      }
    }

    // Создаём нового пользователя с уникальным реферальным кодом
    user = await prisma.user.create({
      data: {
        telegramId: BigInt(telegramId),
        username,
        firstName,
        lastName,
        referralCode: generateReferralCode(),
        referredById: referrerId
      }
    });

    console.log(`✅ Создан новый пользователь: ${telegramId} (@${username})${referrerId ? ' (по реферальной ссылке)' : ''}`);
  } else {
    // Обновляем информацию о пользователе, если она изменилась
    const updates: any = {};
    if (username !== user.username) updates.username = username;
    if (firstName !== user.firstName) updates.firstName = firstName;
    if (lastName !== user.lastName) updates.lastName = lastName;
    // Генерируем реферальный код если его нет
    if (!user.referralCode) updates.referralCode = generateReferralCode();

    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updates
      });
    }
  }

  return user;
}

/**
 * Получает пользователя по Telegram ID
 */
export async function getUserByTelegramId(telegramId: number): Promise<User | null> {
  return await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) }
  });
}

/**
 * Получает пользователя по внутреннему ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  return await prisma.user.findUnique({
    where: { id: userId }
  });
}

/**
 * Получает всех пользователей (для админа)
 */
export async function getAllUsers(): Promise<User[]> {
  return await prisma.user.findMany({
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Получает количество пользователей
 */
export async function getUsersCount(): Promise<number> {
  return await prisma.user.count();
}

/**
 * Получает пользователя по реферальному коду
 */
export async function getUserByReferralCode(code: string): Promise<User | null> {
  return await prisma.user.findUnique({
    where: { referralCode: code }
  });
}

/**
 * Получает список рефералов пользователя
 */
export async function getUserReferrals(userId: string): Promise<User[]> {
  return await prisma.user.findMany({
    where: { referredById: userId },
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Получает реферальную статистику пользователя
 */
export async function getReferralStats(userId: string): Promise<{
  referralCode: string | null;
  totalReferrals: number;
  totalBonus: number;
  referrals: Array<{ username: string | null; firstName: string | null; createdAt: Date }>;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      referrals: {
        select: {
          username: true,
          firstName: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!user) {
    return {
      referralCode: null,
      totalReferrals: 0,
      totalBonus: 0,
      referrals: []
    };
  }

  return {
    referralCode: user.referralCode,
    totalReferrals: user.referrals.length,
    totalBonus: user.referralBonus,
    referrals: user.referrals
  };
}

/**
 * Начисляет реферальный бонус (5% от стоимости консультации)
 */
export async function addReferralBonus(userId: string, paymentAmountCents: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user || !user.referredById) return;

  // 5% от суммы в центах
  const bonus = Math.floor(paymentAmountCents * 0.05);

  await prisma.user.update({
    where: { id: user.referredById },
    data: {
      referralBonus: { increment: bonus }
    }
  });

  console.log(`💰 Начислен реферальный бонус: ${bonus / 100}$ пользователю ${user.referredById}`);
}
