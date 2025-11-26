import { prisma } from './database';

export interface PromoCodeValidationResult {
  valid: boolean;
  promoCode?: {
    id: string;
    code: string;
    discountPercent: number;
  };
  error?: string;
}

/**
 * Создание нового промокода
 */
export async function createPromoCode(
  code: string,
  discountPercent: number,
  expiresAt: Date,
  serviceId: string | null,
  createdBy: bigint
) {
  // Приводим код к верхнему регистру
  const normalizedCode = code.toUpperCase().trim();

  // Проверяем, не существует ли уже такой код
  const existing = await prisma.promoCode.findUnique({
    where: { code: normalizedCode }
  });

  if (existing) {
    throw new Error(`Промокод "${normalizedCode}" уже существует`);
  }

  return prisma.promoCode.create({
    data: {
      code: normalizedCode,
      discountPercent,
      expiresAt,
      serviceId,
      createdBy
    }
  });
}

/**
 * Валидация промокода
 */
export async function validatePromoCode(
  code: string,
  userId: string,
  serviceId: string
): Promise<PromoCodeValidationResult> {
  const normalizedCode = code.toUpperCase().trim();

  // Ищем промокод
  const promoCode = await prisma.promoCode.findUnique({
    where: { code: normalizedCode },
    include: {
      usages: {
        where: { userId }
      }
    }
  });

  if (!promoCode) {
    return { valid: false, error: 'Промокод не найден' };
  }

  if (!promoCode.isActive) {
    return { valid: false, error: 'Промокод деактивирован' };
  }

  if (promoCode.expiresAt < new Date()) {
    return { valid: false, error: 'Срок действия промокода истёк' };
  }

  // Проверяем привязку к услуге
  if (promoCode.serviceId && promoCode.serviceId !== serviceId) {
    return { valid: false, error: 'Промокод не применим к этой услуге' };
  }

  // Проверяем, не использовал ли пользователь этот промокод
  if (promoCode.usages.length > 0) {
    return { valid: false, error: 'Вы уже использовали этот промокод' };
  }

  return {
    valid: true,
    promoCode: {
      id: promoCode.id,
      code: promoCode.code,
      discountPercent: promoCode.discountPercent
    }
  };
}

/**
 * Расчёт скидки
 */
export function calculateDiscount(amountCents: number, discountPercent: number): number {
  return Math.round(amountCents * discountPercent / 100);
}

/**
 * Применение скидки к сумме
 */
export function applyDiscount(amountCents: number, discountPercent: number): number {
  const discount = calculateDiscount(amountCents, discountPercent);
  return amountCents - discount;
}

/**
 * Запись использования промокода
 */
export async function recordPromoUsage(
  promoCodeId: string,
  userId: string,
  bookingId: string,
  discountAmount: number
) {
  return prisma.promoCodeUsage.create({
    data: {
      promoCodeId,
      userId,
      bookingId,
      discountAmount
    }
  });
}

/**
 * Получение списка активных промокодов
 */
export async function getActivePromoCodes() {
  return prisma.promoCode.findMany({
    where: {
      isActive: true,
      expiresAt: {
        gt: new Date()
      }
    },
    include: {
      _count: {
        select: { usages: true }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
}

/**
 * Получение всех промокодов (включая неактивные)
 */
export async function getAllPromoCodes() {
  return prisma.promoCode.findMany({
    include: {
      _count: {
        select: { usages: true }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
}

/**
 * Деактивация промокода
 */
export async function deactivatePromoCode(code: string) {
  const normalizedCode = code.toUpperCase().trim();

  const promoCode = await prisma.promoCode.findUnique({
    where: { code: normalizedCode }
  });

  if (!promoCode) {
    throw new Error(`Промокод "${normalizedCode}" не найден`);
  }

  return prisma.promoCode.update({
    where: { code: normalizedCode },
    data: { isActive: false }
  });
}

/**
 * Получение промокода по ID
 */
export async function getPromoCodeById(id: string) {
  return prisma.promoCode.findUnique({
    where: { id },
    include: {
      _count: {
        select: { usages: true }
      }
    }
  });
}

/**
 * Маппинг короткого названия услуги на serviceId
 */
export function getServiceIdFromShortName(shortName: string): string | null {
  const mapping: Record<string, string> = {
    'online': 'service_online',
    'written': 'service_written',
    'conclusion': 'service_conclusion',
    'all': ''  // пустая строка означает "все услуги"
  };

  const normalized = shortName.toLowerCase().trim();
  const result = mapping[normalized];

  if (result === '') return null;  // все услуги
  if (result) return result;

  return null;  // неизвестное название = все услуги
}

/**
 * Получение названия услуги по serviceId
 */
export function getServiceNameById(serviceId: string | null): string {
  if (!serviceId) return 'все услуги';

  const mapping: Record<string, string> = {
    'service_online': 'Онлайн-консультация',
    'service_written': 'Письменное заключение',
    'service_conclusion': 'Консультация с выводами'
  };

  return mapping[serviceId] || serviceId;
}
