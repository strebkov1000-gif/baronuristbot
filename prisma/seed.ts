import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Начинаем заполнение базы данных...');

  // Создаём 4 услуги согласно ТЗ
  const services = [
    {
      serviceId: 'service_online',
      name: 'Онлайн-консультация',
      nameEn: 'Online Consultation',
      description: 'Формат: 1-2 звонка без детального изучения документов. Подходит, если нужно понять общие риски и стратегию действий.',
      stages: JSON.stringify([
        'Вы бронируете дату и время',
        'Вносите предоплату 25%',
        'В назначенное время мы созваниваемся в выбранном формате (Telegram / Zoom)',
        'Получаете консультацию и рекомендации'
      ]),
      priceUsd: 4000, // 40.00 USD в центах
      durationMinutes: 60,
      requiresBooking: true
    },
    {
      serviceId: 'service_written',
      name: 'Письменная консультация с изучением документов',
      nameEn: 'Written Consultation with Document Review',
      description: 'Два звонка: первый — сбор деталей и документов, второй — разбор результата. Включает детальное изучение материалов вашего дела.',
      stages: JSON.stringify([
        'Вы бронируете дату и время',
        'Вносите предоплату 25%',
        'Первый звонок: обсуждение ситуации и сбор документов',
        'Юрист изучает материалы и готовит письменную консультацию',
        'Второй звонок: разбор результатов и ответы на вопросы'
      ]),
      priceUsd: 9000, // 90.00 USD в центах
      durationMinutes: 60,
      requiresBooking: true
    },
    {
      serviceId: 'service_conclusion',
      name: 'Правовое заключение с изучением материалов дела',
      nameEn: 'Legal Opinion with Case Materials Review',
      description: 'Глубокий разбор вашей ситуации с детальным изучением всех документов и материалов дела. Включает письменное заключение с анализом рисков, перспектив и рекомендаций.',
      stages: JSON.stringify([
        'Вы бронируете дату и время',
        'Вносите предоплату 25%',
        'Передаёте все материалы дела юристу',
        'Юрист проводит глубокий анализ документов',
        'Готовится подробное письменное заключение',
        'Созвон для обсуждения заключения и стратегии'
      ]),
      priceUsd: 15000, // 150.00 USD в центах
      durationMinutes: 90,
      requiresBooking: true
    },
    {
      serviceId: 'service_other',
      name: 'Иные услуги',
      nameEn: 'Other Services',
      description: 'Если вам нужна услуга, которая не подходит под описанные выше категории, заполните анкету, и мы свяжемся с вами для подбора подходящего решения.',
      stages: JSON.stringify([
        'Заполните анкету с описанием вашей ситуации',
        'Наш менеджер свяжется с вами',
        'Мы подберём подходящую услугу и обсудим детали'
      ]),
      priceUsd: 0, // Цена договорная
      durationMinutes: 0, // Не требует бронирования времени
      requiresBooking: false
    }
  ];

  console.log('📝 Создаём услуги...');

  for (const serviceData of services) {
    const service = await prisma.service.upsert({
      where: { serviceId: serviceData.serviceId },
      update: serviceData,
      create: serviceData
    });

    console.log(`✅ Услуга "${service.name}" создана (ID: ${service.id})`);
  }

  console.log('\n✨ База данных успешно заполнена!');
  console.log(`Создано услуг: ${services.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Ошибка при заполнении базы данных:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
