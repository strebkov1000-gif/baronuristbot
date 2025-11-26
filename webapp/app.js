// Telegram WebApp SDK
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Настройки тёмной темы
tg.setHeaderColor('#0D0D0D');
tg.setBackgroundColor('#0D0D0D');

// Глобальное состояние
const state = {
  userId: null,
  telegramId: null,
  serviceId: null,
  serviceName: null,
  servicePrice: 0,
  serviceDuration: 60,
  selectedDate: null,
  selectedTime: null,
  selectedSlot: null,
  currentMonth: new Date(),
  availableSlots: [],
  datesWithSlots: new Set(),
  services: [],
  bookings: [],
  userData: null,
  currentTab: 'consultations',
  botUsername: 'PravoXIIBot', // Будет обновлен из данных
  // Промокод
  appliedPromoCode: null,
  originalPrepayment: 0,
  discountedPrepayment: 0,
  // MEMO для платежа
  paymentMemo: null,
  // Тип оплаты
  paymentType: 'PREPAYMENT', // PREPAYMENT или FULL
  fullPrice: 0,           // Полная стоимость в центах
  prepaymentPrice: 0,     // Предоплата (25%) в центах
  currentPaymentAmount: 0 // Текущая сумма к оплате в центах
};

// Иконки для услуг
const serviceIcons = {
  'service_online': '💬',
  'service_written': '📝',
  'service_conclusion': '📄',
  'service_other': '✨'
};

// TON wallet address (for USDT on TON network)
const TON_WALLET = 'UQCVeQzrFSinGaW-rX-_kBh5AJxpok2NMtzg9VmqGiMgYOW8';

// Парсинг initData для получения user ID
function parseInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (userStr) {
      const user = JSON.parse(decodeURIComponent(userStr));
      return user.id;
    }
  } catch (e) {
    console.error('Ошибка парсинга initData:', e);
  }
  return null;
}

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  // Получаем данные пользователя из Telegram
  console.log('🔍 initDataUnsafe:', tg.initDataUnsafe);
  console.log('🔍 initData:', tg.initData);
  console.log('🔍 tg object:', tg);

  // Способ 1: из initDataUnsafe
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    state.telegramId = tg.initDataUnsafe.user.id;
    console.log('✅ Telegram ID из initDataUnsafe:', state.telegramId);
  }
  // Способ 2: парсинг initData
  else if (tg.initData) {
    const userId = parseInitData(tg.initData);
    if (userId) {
      state.telegramId = userId;
      console.log('✅ Telegram ID из initData:', state.telegramId);
    }
  }
  // Способ 3: из URL параметров (для тестирования)
  if (!state.telegramId) {
    const urlParams = new URLSearchParams(window.location.search);
    const testId = urlParams.get('tgWebAppUserId') || urlParams.get('user_id');
    if (testId) {
      state.telegramId = parseInt(testId);
      console.log('✅ Telegram ID из URL:', state.telegramId);
    }
  }

  if (!state.telegramId) {
    console.error('❌ Не удалось получить Telegram ID ни одним способом');
  }

  setupTabNavigation();
  setupEventListeners();

  // Загружаем данные для всех вкладок
  await Promise.all([
    loadAllServices(),
    loadUserData(),
    loadUserBookings()
  ]);
});

// ===================
// TAB NAVIGATION
// ===================

function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  state.currentTab = tabName;

  // Обновляем активную кнопку
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Скрываем все табы
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.add('hidden');
  });

  // Показываем нужный таб
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');

  // Скрываем booking flow если он был открыт
  document.getElementById('booking-flow').classList.add('hidden');

  // Показываем header и tabs
  document.querySelector('.header').classList.remove('hidden');
  document.querySelector('.tabs-nav').classList.remove('hidden');
}

// ===================
// CONSULTATIONS (SERVICES)
// ===================

async function loadAllServices() {
  try {
    showLoader();
    const response = await fetch('/api/services');
    if (!response.ok) throw new Error('Failed to load services');

    state.services = await response.json();
    renderServiceCards();
    hideLoader();
  } catch (error) {
    console.error('Error loading services:', error);
    // Fallback услуги
    state.services = [
      {
        id: 'service_online',
        serviceId: 'service_online',
        name: 'Онлайн-консультация',
        description: 'Консультация в формате видеозвонка. Разбор вашей ситуации в режиме реального времени.',
        priceUsd: 4000,
        durationMinutes: 60,
        requiresBooking: true
      },
      {
        id: 'service_written',
        serviceId: 'service_written',
        name: 'Письменная консультация',
        description: 'Детальный письменный ответ на ваши вопросы с анализом документов.',
        priceUsd: 9000,
        durationMinutes: 60,
        requiresBooking: true
      },
      {
        id: 'service_conclusion',
        serviceId: 'service_conclusion',
        name: 'Правовое заключение',
        description: 'Полноценный правовой документ с глубоким анализом и рекомендациями.',
        priceUsd: 15000,
        durationMinutes: 60,
        requiresBooking: true
      }
    ];
    renderServiceCards();
    hideLoader();
  }
}

function renderServiceCards() {
  const grid = document.getElementById('services-grid');
  grid.innerHTML = '';

  const bookableServices = state.services.filter(s =>
    s.requiresBooking !== false && s.serviceId !== 'service_other'
  );

  bookableServices.forEach(service => {
    const icon = serviceIcons[service.serviceId] || '📋';
    const price = (service.priceUsd / 100).toFixed(0);
    const prepayment = Math.round(price * 0.25);

    const card = document.createElement('div');
    card.className = 'service-card';
    card.innerHTML = `
      <div class="service-card-icon">${icon}</div>
      <div class="service-card-header">
        <div class="service-card-title">${service.name}</div>
        <div class="service-card-price">$${price}</div>
      </div>
      <div class="service-card-description">${service.description}</div>
      <div class="service-card-footer">
        <div class="service-card-meta">
          <div class="service-card-duration">${service.durationMinutes} мин</div>
          <div class="service-card-prepayment">Предоплата $${prepayment}</div>
        </div>
        <div class="service-card-arrow">→</div>
      </div>
    `;

    card.addEventListener('click', () => selectService(service));
    grid.appendChild(card);
  });
}

// ===================
// MY BOOKINGS
// ===================

async function loadUserBookings() {
  if (!state.telegramId) return;

  try {
    const response = await fetch(`/api/bookings/${state.telegramId}`);
    if (!response.ok) throw new Error('Failed to load bookings');

    state.bookings = await response.json();
    renderBookings();
  } catch (error) {
    console.error('Error loading bookings:', error);
    state.bookings = [];
    renderBookings();
  }
}

function renderBookings() {
  const container = document.getElementById('bookings-container');

  if (state.bookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <h3>Нет активных записей</h3>
        <p>Запишитесь на консультацию, чтобы увидеть её здесь</p>
        <button class="button button-primary" onclick="switchTab('consultations')">
          Записаться
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.bookings.map(booking => {
    const startTime = new Date(booking.startTime);
    const dateStr = startTime.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const timeStr = startTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const statusEmoji = booking.status === 'CONFIRMED' ? '✅' : '⏳';
    const statusText = booking.status === 'CONFIRMED' ? 'Подтверждено' : 'Ожидает оплаты';
    const statusClass = booking.status === 'CONFIRMED' ? 'confirmed' : 'pending';
    const isPending = booking.status === 'PENDING';

    // Проверяем, есть ли остаток к оплате для подтверждённых бронирований
    const hasRemainingPayment = booking.status === 'CONFIRMED' &&
                                 booking.remainingAmountUsd &&
                                 booking.remainingAmountUsd > 0;
    const remainingUsd = hasRemainingPayment ? (booking.remainingAmountUsd / 100).toFixed(0) : 0;

    // Определяем, кликабельна ли карточка
    const isClickable = isPending || hasRemainingPayment;
    const clickHandler = isPending
      ? `onclick="showBookingPayment('${booking.id}')"`
      : hasRemainingPayment
        ? `onclick="showRemainingPayment('${booking.id}')"`
        : '';

    return `
      <div class="booking-card ${isClickable ? 'clickable' : ''}" ${clickHandler}>
        <div class="booking-header">
          <div class="booking-service">${booking.serviceName}</div>
          <div class="booking-status ${statusClass}">${statusEmoji} ${statusText}</div>
        </div>
        <div class="booking-details">
          <div class="booking-datetime">
            <span class="booking-icon">📅</span>
            <span>${dateStr} в ${timeStr}</span>
          </div>
          <div class="booking-price">
            <span class="booking-icon">💰</span>
            <span>$${(booking.priceUsd / 100).toFixed(0)}</span>
          </div>
        </div>
        ${isPending ? `
          <div class="booking-action">
            <span class="action-text">Нажмите для оплаты →</span>
          </div>
        ` : ''}
        ${hasRemainingPayment ? `
          <div class="booking-remaining">
            <div class="remaining-info">
              <span class="remaining-icon">💳</span>
              <span class="remaining-text">Остаток к оплате: <strong>${remainingUsd} USDT</strong></span>
            </div>
            <div class="booking-action">
              <span class="action-text">Нажмите для оплаты остатка →</span>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Текущее открытое бронирование для страницы оплаты
let currentPaymentBooking = null;

async function showBookingPayment(bookingId) {
  try {
    // Загружаем детали бронирования с платёжной информацией
    const response = await fetch(`/api/booking/${bookingId}`);
    if (!response.ok) throw new Error('Failed to load booking');

    const booking = await response.json();
    currentPaymentBooking = booking;

    // Скрываем tabs и показываем детали платежа
    document.querySelector('.tabs-nav').classList.add('hidden');
    document.getElementById('tab-bookings').classList.add('hidden');

    const container = document.getElementById('bookings-container');
    container.parentElement.classList.remove('hidden');

    const startTime = new Date(booking.startTime);
    const dateStr = startTime.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const timeStr = startTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Проверяем, есть ли уже применённая скидка
    const hasDiscount = booking.promoInfo && booking.promoInfo.length > 0;

    container.innerHTML = `
      <div class="payment-details-page">
        <button class="back-button" onclick="closeBookingPayment()">
          <span class="back-arrow">←</span> К записям
        </button>

        <h2 class="page-title">Оплата записи</h2>

        <div class="booking-summary">
          <div class="summary-row">
            <span class="summary-label">Услуга:</span>
            <span class="summary-value">${booking.serviceName}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Дата:</span>
            <span class="summary-value">${dateStr}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Время:</span>
            <span class="summary-value">${timeStr} (МСК)</span>
          </div>
          <div class="summary-row highlight">
            <span class="summary-label">К оплате:</span>
            <span class="summary-value" id="payment-amount">${booking.prepaymentUsd} USDT</span>
          </div>
        </div>

        <!-- Промокод -->
        ${!hasDiscount ? `
        <div class="promo-section">
          <div class="promo-title">🎁 Есть промокод?</div>
          <div class="promo-input-row">
            <input type="text" id="booking-promo-code" class="promo-input" placeholder="Введите промокод" maxlength="20">
            <button class="button button-secondary" id="apply-booking-promo">Применить</button>
          </div>
          <div id="booking-promo-result" class="promo-result hidden"></div>
        </div>
        ` : `
        <div class="promo-applied">
          <span class="promo-applied-icon">✅</span>
          <span class="promo-applied-text">${booking.promoInfo}</span>
        </div>
        `}

        <div class="payment-info-box">
          <div class="payment-info-title">💳 Данные для оплаты</div>

          <div class="payment-field">
            <div class="payment-label">Адрес кошелька (USDT TON):</div>
            <div class="payment-value">${TON_WALLET}</div>
            <button class="copy-btn" onclick="copyToClipboard('${TON_WALLET}'); tg.showAlert('Адрес скопирован!');">📋</button>
          </div>

          <div class="payment-field">
            <div class="payment-label">Комментарий (ОБЯЗАТЕЛЬНО!):</div>
            <div class="payment-value payment-memo">${booking.paymentMemo}</div>
            <button class="copy-btn" onclick="copyToClipboard('${booking.paymentMemo}'); tg.showAlert('Комментарий скопирован!');">📋</button>
          </div>
        </div>

        <div class="warning-box">
          ⚠️ Отправьте <b>ровно <span id="warning-amount">${booking.prepaymentUsd}</span> USDT</b> в сети TON с указанием комментария.<br><br>
          <b>Без комментария платёж не будет зачислен!</b>
        </div>

        <div class="payment-auto-info">
          ✅ Платёж будет зачислен автоматически в течение 1-2 минут
        </div>
      </div>
    `;

    // Добавляем обработчик для промокода если секция существует
    const promoBtn = document.getElementById('apply-booking-promo');
    if (promoBtn) {
      promoBtn.addEventListener('click', () => applyBookingPromoCode(bookingId));
      document.getElementById('booking-promo-code').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyBookingPromoCode(bookingId);
      });
    }

  } catch (error) {
    console.error('Error loading booking:', error);
    tg.showAlert('Ошибка загрузки данных');
  }
}

async function applyBookingPromoCode(bookingId) {
  const promoInput = document.getElementById('booking-promo-code');
  const promoBtn = document.getElementById('apply-booking-promo');
  const promoResult = document.getElementById('booking-promo-result');

  const code = promoInput.value.trim().toUpperCase();

  if (!code) {
    promoResult.textContent = 'Введите промокод';
    promoResult.className = 'promo-result error';
    promoResult.classList.remove('hidden');
    return;
  }

  if (!state.telegramId) {
    promoResult.textContent = 'Ошибка: откройте приложение через бота';
    promoResult.className = 'promo-result error';
    promoResult.classList.remove('hidden');
    return;
  }

  promoBtn.disabled = true;
  promoBtn.textContent = '...';

  try {
    // Применяем промокод к бронированию
    const response = await fetch('/api/booking/apply-promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId: bookingId,
        promoCode: code,
        telegramId: state.telegramId
      })
    });

    const result = await response.json();

    if (result.success) {
      // Обновляем сумму на странице
      document.getElementById('payment-amount').textContent = result.newAmount + ' USDT';
      document.getElementById('warning-amount').textContent = result.newAmount;

      promoResult.textContent = `Промокод применён! Скидка ${result.discountPercent}%`;
      promoResult.className = 'promo-result success';
      promoResult.classList.remove('hidden');

      promoInput.disabled = true;
      promoBtn.textContent = 'Применён';
    } else {
      promoResult.textContent = result.error || 'Недействительный промокод';
      promoResult.className = 'promo-result error';
      promoResult.classList.remove('hidden');
      promoBtn.disabled = false;
      promoBtn.textContent = 'Применить';
    }
  } catch (error) {
    console.error('Promo error:', error);
    promoResult.textContent = 'Ошибка сети';
    promoResult.className = 'promo-result error';
    promoResult.classList.remove('hidden');
    promoBtn.disabled = false;
    promoBtn.textContent = 'Применить';
  }
}

function closeBookingPayment() {
  // Показываем tabs обратно
  document.querySelector('.tabs-nav').classList.remove('hidden');
  document.getElementById('tab-bookings').classList.remove('hidden');

  // Перезагружаем список записей
  loadUserBookings();
}

// Состояние для оплаты остатка
let remainingPaymentState = {
  bookingId: null,
  booking: null,
  paymentMemo: null,
  remainingAmount: 0,  // в центах
  selectedAmount: 0    // выбранная сумма к оплате в центах
};

// Показать страницу оплаты остатка с выбором суммы
async function showRemainingPayment(bookingId) {
  try {
    // Находим бронирование в state
    const booking = state.bookings.find(b => b.id === bookingId);
    if (!booking) {
      tg.showAlert('Бронирование не найдено');
      return;
    }

    // Сохраняем в состояние
    remainingPaymentState.bookingId = bookingId;
    remainingPaymentState.booking = booking;
    remainingPaymentState.remainingAmount = booking.remainingAmountUsd;

    // Скрываем tabs
    document.querySelector('.tabs-nav').classList.add('hidden');
    document.getElementById('tab-bookings').classList.add('hidden');

    const container = document.getElementById('bookings-container');
    container.parentElement.classList.remove('hidden');

    // Показываем загрузку пока получаем MEMO
    container.innerHTML = `
      <div class="payment-details-page">
        <div class="loader"></div>
        <p style="text-align: center; margin-top: 16px;">Подготовка платежа...</p>
      </div>
    `;

    // Получаем или генерируем MEMO
    let paymentMemo = booking.remainingPaymentMemo;
    if (!paymentMemo) {
      try {
        const response = await fetch('/api/booking/pay-remaining', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: bookingId,
            telegramId: state.telegramId
          })
        });

        const result = await response.json();

        if (result.success) {
          paymentMemo = result.paymentMemo;
          booking.remainingPaymentMemo = paymentMemo;
        } else {
          tg.showAlert(result.error || 'Ошибка создания платежа');
          closeBookingPayment();
          return;
        }
      } catch (error) {
        console.error('Error creating remaining payment:', error);
        tg.showAlert('Ошибка сети');
        closeBookingPayment();
        return;
      }
    }

    remainingPaymentState.paymentMemo = paymentMemo;

    // Рассчитываем суммы
    const totalPriceUsd = booking.totalPriceUsd; // в центах
    const prepaidAmountUsd = booking.prepaidAmountUsd; // в центах
    const remainingAmountUsd = booking.remainingAmountUsd; // в центах

    // Минимальный платёж - 25% от остатка (но минимум то что осталось если меньше)
    const minPayment = Math.min(Math.ceil(remainingAmountUsd * 0.25), remainingAmountUsd);

    // По умолчанию выбрана полная оплата остатка
    remainingPaymentState.selectedAmount = remainingAmountUsd;

    const startTime = new Date(booking.startTime);
    const dateStr = startTime.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const timeStr = startTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Отображаем страницу с выбором типа оплаты
    container.innerHTML = `
      <div class="payment-details-page">
        <button class="back-button" onclick="closeBookingPayment()">
          <span class="back-arrow">←</span> К записям
        </button>

        <h2 class="page-title">💳 Оплата</h2>

        <div class="booking-summary">
          <div class="summary-row">
            <span class="summary-label">Услуга:</span>
            <span class="summary-value">${booking.serviceName}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Дата:</span>
            <span class="summary-value">${dateStr}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Время:</span>
            <span class="summary-value">${timeStr} (МСК)</span>
          </div>
          <div class="summary-divider"></div>
          <div class="summary-row">
            <span class="summary-label">Полная стоимость:</span>
            <span class="summary-value">$${(totalPriceUsd / 100).toFixed(0)}</span>
          </div>
          <div class="summary-row success-row">
            <span class="summary-label">✅ Уже оплачено:</span>
            <span class="summary-value success-text">$${(prepaidAmountUsd / 100).toFixed(0)}</span>
          </div>
          <div class="summary-row highlight">
            <span class="summary-label">Остаток к оплате:</span>
            <span class="summary-value">${(remainingAmountUsd / 100).toFixed(0)} USDT</span>
          </div>
        </div>

        <!-- Выбор типа оплаты -->
        <div class="payment-type-selection">
          <div class="payment-type-option" id="remaining-option-partial" onclick="selectRemainingPaymentType('PARTIAL')">
            <div class="payment-type-radio"></div>
            <div class="payment-type-content">
              <div class="payment-type-title">Частичная оплата (25%)</div>
              <div class="payment-type-amount">${(minPayment / 100).toFixed(0)} USDT</div>
              <div class="payment-type-desc">Оставшаяся сумма: ${((remainingAmountUsd - minPayment) / 100).toFixed(0)} USDT</div>
            </div>
          </div>
          <div class="payment-type-option selected" id="remaining-option-full" onclick="selectRemainingPaymentType('FULL')">
            <div class="payment-type-radio"></div>
            <div class="payment-type-content">
              <div class="payment-type-title">Полная оплата остатка</div>
              <div class="payment-type-amount">${(remainingAmountUsd / 100).toFixed(0)} USDT</div>
              <div class="payment-type-desc">Закрыть всю задолженность</div>
            </div>
          </div>
        </div>

        <div class="summary-row highlight" style="margin: 16px 0; padding: 12px; background: var(--bg-secondary); border-radius: 8px;">
          <span class="summary-label">К оплате сейчас:</span>
          <span class="summary-value" id="remaining-payment-amount">${(remainingAmountUsd / 100).toFixed(0)} USDT</span>
        </div>

        <div class="payment-info-box">
          <div class="payment-info-title">💳 Данные для оплаты</div>

          <div class="payment-field">
            <div class="payment-label">Адрес кошелька (USDT TON):</div>
            <div class="payment-value">${TON_WALLET}</div>
            <button class="copy-btn" onclick="copyToClipboard('${TON_WALLET}'); tg.showAlert('Адрес скопирован!');">📋</button>
          </div>

          <div class="payment-field">
            <div class="payment-label">Комментарий (ОБЯЗАТЕЛЬНО!):</div>
            <div class="payment-value payment-memo">${paymentMemo}</div>
            <button class="copy-btn" onclick="copyToClipboard('${paymentMemo}'); tg.showAlert('Комментарий скопирован!');">📋</button>
          </div>
        </div>

        <div class="warning-box">
          ⚠️ Отправьте <b>ровно <span id="remaining-warning-amount">${(remainingAmountUsd / 100).toFixed(0)}</span> USDT</b> в сети TON с указанием комментария.<br><br>
          <b>Без комментария платёж не будет зачислен!</b>
        </div>

        <div class="payment-auto-info">
          ✅ Платёж будет зачислен автоматически в течение 1-2 минут
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error showing remaining payment:', error);
    tg.showAlert('Ошибка загрузки данных');
  }
}

// Выбор типа оплаты остатка
function selectRemainingPaymentType(type) {
  const booking = remainingPaymentState.booking;
  const remainingAmountUsd = booking.remainingAmountUsd;
  const minPayment = Math.min(Math.ceil(remainingAmountUsd * 0.25), remainingAmountUsd);

  // Обновляем выделение
  document.getElementById('remaining-option-partial').classList.toggle('selected', type === 'PARTIAL');
  document.getElementById('remaining-option-full').classList.toggle('selected', type === 'FULL');

  // Обновляем сумму
  let amount;
  if (type === 'PARTIAL') {
    amount = minPayment;
  } else {
    amount = remainingAmountUsd;
  }

  remainingPaymentState.selectedAmount = amount;

  // Обновляем UI
  const amountStr = (amount / 100).toFixed(0);
  document.getElementById('remaining-payment-amount').textContent = `${amountStr} USDT`;
  document.getElementById('remaining-warning-amount').textContent = amountStr;
}

// ===================
// REFERRALS
// ===================

async function loadUserData() {
  if (!state.telegramId) {
    console.warn('loadUserData: telegramId не установлен');
    renderReferralsError();
    return;
  }

  try {
    const response = await fetch(`/api/user/${state.telegramId}`);
    if (!response.ok) throw new Error('Failed to load user data');

    state.userData = await response.json();
    renderReferrals();
  } catch (error) {
    console.error('Error loading user data:', error);
    renderReferrals();
  }
}

function renderReferralsError() {
  const container = document.getElementById('referrals-container');
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <h3>Не удалось загрузить данные</h3>
      <p>Откройте приложение через кнопку в боте @pravoxiibot</p>
    </div>
  `;
}

function renderReferrals() {
  const container = document.getElementById('referrals-container');

  if (!state.userData || !state.userData.referralCode) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <h3>Реферальная программа</h3>
        <p>Данные загружаются...</p>
      </div>
    `;
    return;
  }

  const referralLink = `https://t.me/${state.botUsername}?start=${state.userData.referralCode}`;
  const bonusUsd = (state.userData.referralBonus / 100).toFixed(2);

  let referralsList = '';
  if (state.userData.referrals && state.userData.referrals.length > 0) {
    referralsList = `
      <div class="referrals-list">
        <h3>Приглашённые друзья</h3>
        ${state.userData.referrals.slice(0, 10).map(ref => {
          const name = ref.firstName || ref.username || 'Пользователь';
          const date = new Date(ref.createdAt).toLocaleDateString('ru-RU');
          return `
            <div class="referral-item">
              <span class="referral-name">${name}</span>
              <span class="referral-date">${date}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="referral-banner">
      <div class="referral-bonus">
        <span class="bonus-value">5%</span>
        <span class="bonus-label">бонус за каждого друга</span>
      </div>
      <p class="referral-description">
        Приглашайте друзей и получайте 5% от стоимости каждой консультации, на которую они запишутся!
      </p>
    </div>

    <div class="referral-link-box">
      <div class="referral-link-label">Ваша реферальная ссылка:</div>
      <div class="referral-link" id="referral-link">${referralLink}</div>
      <button class="button button-primary" id="copy-referral">
        📋 Копировать ссылку
      </button>
      <button class="button button-secondary" id="share-referral">
        📤 Поделиться
      </button>
    </div>

    <div class="referral-stats">
      <div class="stat-item">
        <div class="stat-value">${state.userData.totalReferrals}</div>
        <div class="stat-label">Приглашено</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">$${bonusUsd}</div>
        <div class="stat-label">Накоплено</div>
      </div>
    </div>

    ${referralsList}
  `;

  // Обработчики для кнопок
  document.getElementById('copy-referral').addEventListener('click', () => {
    copyToClipboard(referralLink);
    tg.showAlert('Ссылка скопирована!');
  });

  document.getElementById('share-referral').addEventListener('click', () => {
    const text = `Приглашаю тебя в PRAVO XII - юридические консультации онлайн!\n\n${referralLink}`;
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`);
  });
}

// ===================
// BOOKING FLOW
// ===================

async function selectService(service) {
  state.serviceId = service.serviceId || service.id;
  state.serviceName = service.name;
  state.servicePrice = service.priceUsd / 100;
  state.serviceDuration = service.durationMinutes;

  // Сохраняем предоплату в центах для расчёта скидки
  state.originalPrepayment = Math.floor(service.priceUsd * 0.25);

  // Сбрасываем промокод при выборе новой услуги
  resetPromoCode();

  // Обновляем UI
  document.getElementById('service-name').textContent = service.name;
  document.getElementById('service-price').textContent = `$${state.servicePrice.toFixed(0)}`;
  document.getElementById('service-name-2').textContent = service.name;
  document.getElementById('confirm-service').textContent = service.name;
  document.getElementById('confirm-duration').textContent = `${state.serviceDuration} мин`;
  document.getElementById('confirm-price').textContent = `$${state.servicePrice.toFixed(0)}`;

  const prepaymentUsd = state.servicePrice * 0.25;
  document.getElementById('confirm-prepayment').textContent = `${prepaymentUsd.toFixed(0)} USDT`;
  document.getElementById('ton-amount').textContent = prepaymentUsd.toFixed(0);

  await loadAvailableDates();
  showBookingFlow();
  renderCalendar();
}

async function loadAvailableDates() {
  try {
    const response = await fetch('/api/available-dates');
    if (!response.ok) throw new Error('Failed to load available dates');

    const data = await response.json();
    state.datesWithSlots = new Set(data.dates || []);
  } catch (error) {
    console.error('Error loading available dates:', error);
    state.datesWithSlots = new Set();
  }
}

function showBookingFlow() {
  // Скрываем табы и хедер
  document.querySelector('.tabs-nav').classList.add('hidden');
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));

  // Показываем booking flow
  document.getElementById('booking-flow').classList.remove('hidden');

  // Показываем шаг выбора даты
  document.getElementById('date-selection').classList.remove('hidden');
  document.getElementById('time-selection').classList.add('hidden');
  document.getElementById('confirmation-step').classList.add('hidden');

  updateSteps(1);
}

function showServiceSelection() {
  document.getElementById('booking-flow').classList.add('hidden');
  document.querySelector('.tabs-nav').classList.remove('hidden');
  document.getElementById('tab-consultations').classList.remove('hidden');

  // Сбрасываем состояние
  state.selectedDate = null;
  state.selectedTime = null;
  state.selectedSlot = null;
  document.getElementById('continue-to-time').disabled = true;
  document.getElementById('continue-to-confirm').disabled = true;
}

// ===================
// CALENDAR
// ===================

function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();

  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  document.getElementById('current-month').textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  let firstDayWeekday = firstDay.getDay();
  firstDayWeekday = firstDayWeekday === 0 ? 6 : firstDayWeekday - 1;

  const calendarGrid = document.getElementById('calendar-grid');
  const dayHeaders = calendarGrid.querySelectorAll('.calendar-day-header');
  calendarGrid.innerHTML = '';
  dayHeaders.forEach(header => calendarGrid.appendChild(header));

  for (let i = 0; i < firstDayWeekday; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day disabled';
    calendarGrid.appendChild(emptyCell);
  }

  const today = new Date();
  const todayStr = formatDateISO(today);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = formatDateISO(date);

    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    dayCell.textContent = day;

    if (dateStr < todayStr) {
      dayCell.classList.add('disabled');
    } else if (state.datesWithSlots.has(dateStr)) {
      dayCell.classList.add('has-slots');

      if (dateStr === todayStr) {
        dayCell.classList.add('today');
      }

      dayCell.addEventListener('click', () => selectDate(date));

      if (state.selectedDate && formatDateISO(state.selectedDate) === dateStr) {
        dayCell.classList.add('selected');
      }
    } else {
      dayCell.classList.add('unavailable');
    }

    calendarGrid.appendChild(dayCell);
  }
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function selectDate(date) {
  state.selectedDate = date;
  state.selectedTime = null;
  state.selectedSlot = null;

  renderCalendar();
  document.getElementById('continue-to-time').disabled = false;
}

// ===================
// TIME SLOTS
// ===================

async function showTimeSelection() {
  if (!state.selectedDate) {
    tg.showAlert('Пожалуйста, выберите дату');
    return;
  }

  updateSteps(2);

  document.getElementById('date-selection').classList.add('hidden');
  document.getElementById('time-selection').classList.remove('hidden');
  document.getElementById('confirmation-step').classList.add('hidden');

  const dateStr = state.selectedDate.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  document.getElementById('selected-date-display').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  await loadTimeSlotsForDate();
}

async function loadTimeSlotsForDate() {
  try {
    showLoader();

    const dateStr = formatDateISO(state.selectedDate);
    const response = await fetch(`/api/slots?date=${dateStr}`);

    if (!response.ok) throw new Error('Failed to load slots');

    state.availableSlots = await response.json();
    renderTimeSlots();

    hideLoader();
  } catch (error) {
    console.error('Error loading slots:', error);
    tg.showAlert('Ошибка загрузки слотов');
    hideLoader();
  }
}

function renderTimeSlots() {
  const grid = document.getElementById('time-slots-grid');
  grid.innerHTML = '';

  if (state.availableSlots.length === 0) {
    grid.innerHTML = `
      <div class="no-slots-message">
        На эту дату нет доступных слотов.<br>
        Выберите другую дату.
      </div>
    `;
    return;
  }

  state.availableSlots.forEach(slot => {
    const slotElement = document.createElement('div');
    slotElement.className = 'time-slot';
    slotElement.innerHTML = `<span>${slot.startTime} - ${slot.endTime}</span>`;

    if (slot.isBooked) {
      slotElement.classList.add('unavailable');
      slotElement.title = 'Время занято';
    } else {
      slotElement.addEventListener('click', () => selectTimeSlot(slot));

      if (state.selectedSlot && slot.id === state.selectedSlot.id) {
        slotElement.classList.add('selected');
      }
    }

    grid.appendChild(slotElement);
  });
}

function selectTimeSlot(slot) {
  state.selectedSlot = slot;
  state.selectedTime = {
    startTime: slot.startTime,
    endTime: slot.endTime,
    formatted: `${slot.startTime} - ${slot.endTime}`
  };

  renderTimeSlots();
  document.getElementById('continue-to-confirm').disabled = false;
}

// ===================
// CONFIRMATION & PAYMENT
// ===================

async function showConfirmation() {
  if (!state.selectedSlot) {
    tg.showAlert('Пожалуйста, выберите время');
    return;
  }

  updateSteps(3);

  document.getElementById('date-selection').classList.add('hidden');
  document.getElementById('time-selection').classList.add('hidden');
  document.getElementById('confirmation-step').classList.remove('hidden');

  const dateStr = state.selectedDate.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  document.getElementById('confirm-date').textContent = dateStr;
  document.getElementById('confirm-time').textContent = `${state.selectedSlot.startTime} - ${state.selectedSlot.endTime} (МСК)`;

  // Рассчитываем цены В ЦЕНТАХ (servicePrice хранится в долларах)
  state.fullPrice = Math.round(state.servicePrice * 100); // В центах
  state.prepaymentPrice = Math.ceil(state.fullPrice * 0.25); // 25% предоплата в центах

  // Показываем цены в выборе типа оплаты
  document.getElementById('prepayment-amount').textContent = `${(state.prepaymentPrice / 100).toFixed(0)} USDT`;
  document.getElementById('full-amount').textContent = `${(state.fullPrice / 100).toFixed(0)} USDT`;

  // По умолчанию выбрана предоплата
  state.paymentType = 'PREPAYMENT';
  state.currentPaymentAmount = state.prepaymentPrice;
  updatePaymentTypeUI();

  // Загружаем MEMO для платежа
  await loadPaymentMemo();
}

// Функция выбора типа оплаты
function selectPaymentType(type) {
  state.paymentType = type;

  if (type === 'FULL') {
    state.currentPaymentAmount = state.fullPrice;
  } else {
    state.currentPaymentAmount = state.prepaymentPrice;
  }

  updatePaymentTypeUI();
}

// Обновляем UI выбора типа оплаты
// ВАЖНО: state.currentPaymentAmount, state.fullPrice, state.prepaymentPrice - всё в ЦЕНТАХ!
function updatePaymentTypeUI() {
  // Обновляем выделение опций
  document.getElementById('option-prepayment').classList.toggle('selected', state.paymentType === 'PREPAYMENT');
  document.getElementById('option-full').classList.toggle('selected', state.paymentType === 'FULL');

  // Применяем скидку если есть промокод (всё в центах)
  let amountToPay = state.currentPaymentAmount; // в центах
  if (state.appliedPromoCode) {
    amountToPay = Math.ceil(amountToPay * (100 - state.appliedPromoCode.discountPercent) / 100);
  }

  // Обновляем сумму к оплате (конвертируем центы в доллары для отображения)
  const amountUsdt = (amountToPay / 100).toFixed(0);
  document.getElementById('confirm-prepayment').textContent = `${amountUsdt} USDT`;
  document.getElementById('ton-amount').textContent = amountUsdt;

  // Сохраняем суммы в ЦЕНТАХ для промокода
  state.originalPrepayment = state.currentPaymentAmount; // в центах!
  state.discountedPrepayment = amountToPay; // в центах!

  // Если промокод применён, обновляем и его отображение
  if (state.appliedPromoCode) {
    document.getElementById('final-prepayment').textContent = `${amountUsdt} USDT`;
  }
}

async function loadPaymentMemo() {
  try {
    const response = await fetch('/api/generate-memo');
    if (!response.ok) throw new Error('Failed to generate memo');

    const data = await response.json();
    state.paymentMemo = data.memo;

    // Обновляем UI
    document.getElementById('payment-memo').textContent = state.paymentMemo;
    document.getElementById('memo-instruction').textContent = state.paymentMemo;
  } catch (error) {
    console.error('Error loading memo:', error);
    // Fallback - генерируем локально (не рекомендуется, но лучше чем ничего)
    const fallbackMemo = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    state.paymentMemo = fallbackMemo;
    document.getElementById('payment-memo').textContent = fallbackMemo;
    document.getElementById('memo-instruction').textContent = fallbackMemo;
  }
}

// Состояние ожидания оплаты
let paymentWaitingState = {
  bookingId: null,
  paymentMemo: null,
  paymentAmount: 0,
  checkInterval: null,
  isChecking: false
};

async function confirmBooking() {
  const confirmBtn = document.getElementById('confirm-booking');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Создание записи...';

  const dateStr = formatDateISO(state.selectedDate);

  // Рассчитываем сумму к оплате
  let paymentAmount = state.currentPaymentAmount;
  if (state.appliedPromoCode) {
    paymentAmount = Math.ceil(state.currentPaymentAmount * (100 - state.appliedPromoCode.discountPercent) / 100);
  }

  const data = {
    telegramId: state.telegramId,
    serviceId: state.serviceId,
    slotId: state.selectedSlot.id,
    date: dateStr,
    startTime: state.selectedSlot.startTime,
    endTime: state.selectedSlot.endTime,
    paymentType: state.paymentType,
    totalPrice: state.fullPrice,
    paymentAmount: paymentAmount,
    // Передаём MEMO который уже показан пользователю!
    paymentMemo: state.paymentMemo
  };

  // Добавляем промокод если применён
  if (state.appliedPromoCode) {
    data.promoCode = state.appliedPromoCode.code;
    data.promoCodeId = state.appliedPromoCode.id;
    data.discountPercent = state.appliedPromoCode.discountPercent;
  }

  try {
    // Создаём бронирование через API (статус PENDING)
    const response = await fetch('/api/booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (result.success) {
      // Сохраняем данные для проверки оплаты
      paymentWaitingState.bookingId = result.booking.id;
      paymentWaitingState.paymentMemo = result.booking.paymentMemo;
      paymentWaitingState.paymentAmount = paymentAmount;

      // Показываем экран ожидания оплаты
      showPaymentWaitingScreen(result.booking);
    } else {
      tg.showAlert(result.error || 'Ошибка создания записи');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Подтвердить бронирование';
    }
  } catch (error) {
    console.error('Booking error:', error);
    tg.showAlert('Ошибка сети. Попробуйте ещё раз.');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Подтвердить бронирование';
  }
}

// Показать экран ожидания оплаты
function showPaymentWaitingScreen(booking) {
  // Скрываем шаг подтверждения
  document.getElementById('confirmation-step').classList.add('hidden');

  const isFullPayment = booking.paymentType === 'FULL';
  const amountUsdt = (paymentWaitingState.paymentAmount / 100).toFixed(0);

  // Создаём экран ожидания
  const bookingFlow = document.getElementById('booking-flow');
  bookingFlow.innerHTML = `
    <div class="payment-waiting-container">
      <div class="payment-waiting-header">
        <h2>💳 Ожидание оплаты</h2>
        <p class="payment-waiting-subtitle">Переведите средства для подтверждения записи</p>
      </div>

      <div class="payment-status-box" id="payment-status-box">
        <div class="payment-status-icon" id="payment-status-icon">⏳</div>
        <div class="payment-status-text" id="payment-status-text">Ожидаем поступление платежа...</div>
      </div>

      <div class="booking-summary compact">
        <div class="summary-row">
          <span class="summary-label">Услуга:</span>
          <span class="summary-value">${booking.serviceName}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Дата и время:</span>
          <span class="summary-value">${booking.date}, ${booking.time} (МСК)</span>
        </div>
        <div class="summary-row highlight">
          <span class="summary-label">${isFullPayment ? 'К оплате:' : 'Предоплата:'}</span>
          <span class="summary-value">${amountUsdt} USDT</span>
        </div>
      </div>

      <div class="payment-info-box">
        <div class="payment-info-title">💳 Данные для оплаты</div>

        <div class="payment-field">
          <div class="payment-label">Адрес кошелька (USDT TON):</div>
          <div class="payment-value">${TON_WALLET}</div>
          <button class="copy-btn" onclick="copyToClipboard('${TON_WALLET}'); tg.showAlert('Адрес скопирован!');">📋</button>
        </div>

        <div class="payment-field">
          <div class="payment-label">Сумма:</div>
          <div class="payment-value payment-amount-highlight">${amountUsdt} USDT</div>
          <button class="copy-btn" onclick="copyToClipboard('${amountUsdt}'); tg.showAlert('Сумма скопирована!');">📋</button>
        </div>

        <div class="payment-field">
          <div class="payment-label">Комментарий (ОБЯЗАТЕЛЬНО!):</div>
          <div class="payment-value payment-memo">${booking.paymentMemo}</div>
          <button class="copy-btn" onclick="copyToClipboard('${booking.paymentMemo}'); tg.showAlert('Комментарий скопирован!');">📋</button>
        </div>
      </div>

      <div class="warning-box">
        ⚠️ <b>ВАЖНО:</b><br>
        • Отправляйте <b>USDT в сети TON</b> (не TON!)<br>
        • <b>ОБЯЗАТЕЛЬНО</b> укажите комментарий <code>${booking.paymentMemo}</code><br>
        • Без комментария платёж <b>НЕ БУДЕТ</b> зачислен автоматически
      </div>

      <div class="payment-actions">
        <button class="button button-secondary" id="refresh-payment-btn" onclick="manualCheckPayment()">
          🔄 Проверить оплату
        </button>
        <button class="button button-outline" onclick="cancelPaymentWaiting()">
          ← Отмена
        </button>
      </div>

      <div class="payment-auto-check">
        <span class="auto-check-dot"></span>
        Автоматическая проверка каждые 10 секунд
      </div>
    </div>
  `;

  // Запускаем автоматическую проверку
  startPaymentAutoCheck();
}

// Запуск автоматической проверки оплаты
function startPaymentAutoCheck() {
  // Очищаем предыдущий интервал если есть
  if (paymentWaitingState.checkInterval) {
    clearInterval(paymentWaitingState.checkInterval);
  }

  // Первая проверка через 5 секунд
  setTimeout(() => checkPaymentStatus(), 5000);

  // Затем каждые 10 секунд
  paymentWaitingState.checkInterval = setInterval(() => {
    checkPaymentStatus();
  }, 10000);
}

// Остановка автоматической проверки
function stopPaymentAutoCheck() {
  if (paymentWaitingState.checkInterval) {
    clearInterval(paymentWaitingState.checkInterval);
    paymentWaitingState.checkInterval = null;
  }
}

// Проверка статуса оплаты
async function checkPaymentStatus() {
  if (paymentWaitingState.isChecking || !paymentWaitingState.bookingId) {
    return;
  }

  paymentWaitingState.isChecking = true;

  const statusIcon = document.getElementById('payment-status-icon');
  const statusText = document.getElementById('payment-status-text');
  const refreshBtn = document.getElementById('refresh-payment-btn');

  if (statusIcon) statusIcon.textContent = '🔄';
  if (statusText) statusText.textContent = 'Проверяем...';
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const response = await fetch(`/api/booking/${paymentWaitingState.bookingId}/status`);
    const result = await response.json();

    if (result.status === 'CONFIRMED') {
      // Оплата подтверждена!
      stopPaymentAutoCheck();
      showPaymentSuccess(result);
    } else {
      // Ещё не оплачено
      if (statusIcon) statusIcon.textContent = '⏳';
      if (statusText) statusText.textContent = 'Ожидаем поступление платежа...';
    }
  } catch (error) {
    console.error('Payment check error:', error);
    if (statusIcon) statusIcon.textContent = '⏳';
    if (statusText) statusText.textContent = 'Ожидаем поступление платежа...';
  } finally {
    paymentWaitingState.isChecking = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// Ручная проверка оплаты
async function manualCheckPayment() {
  const refreshBtn = document.getElementById('refresh-payment-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '🔄 Проверяем...';
  }

  await checkPaymentStatus();

  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 Проверить оплату';
  }
}

// Показать успешную оплату
function showPaymentSuccess(result) {
  const bookingFlow = document.getElementById('booking-flow');

  bookingFlow.innerHTML = `
    <div class="success-container">
      <div class="success-icon">✅</div>
      <h2 class="success-title">Оплата получена!</h2>
      <p class="success-subtitle">Ваша запись подтверждена</p>

      <div class="success-details">
        <div class="detail-row">
          <span class="detail-label">Услуга:</span>
          <span class="detail-value">${result.serviceName || 'Консультация'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Дата:</span>
          <span class="detail-value">${result.date || ''}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Время:</span>
          <span class="detail-value">${result.time || ''} (МСК)</span>
        </div>
        <div class="detail-row success-row">
          <span class="detail-label">✅ Оплачено:</span>
          <span class="detail-value">${result.paidAmount || paymentWaitingState.paymentAmount / 100} USDT</span>
        </div>
        ${result.remainingAmount > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Остаток:</span>
          <span class="detail-value">${result.remainingAmount} USDT</span>
        </div>
        ` : ''}
      </div>

      <div class="success-message">
        <p>🎉 Спасибо! Мы свяжемся с вами для уточнения деталей консультации.</p>
      </div>

      <button class="button button-primary" onclick="goToMyBookings()">
        Перейти к записям
      </button>
    </div>
  `;

  // Обновляем список записей
  loadUserBookings();
}

// Отмена ожидания оплаты
async function cancelPaymentWaiting() {
  stopPaymentAutoCheck();

  // Можно добавить запрос на отмену бронирования
  // Но пока просто возвращаемся к выбору услуг

  // Восстанавливаем booking-flow
  location.reload(); // Простой способ - перезагрузить страницу
}

function showBookingSuccess(booking) {
  // Скрываем шаг подтверждения
  document.getElementById('confirmation-step').classList.add('hidden');

  // Определяем тип оплаты для отображения
  const isFullPayment = booking.paymentType === 'FULL';
  const remainingText = isFullPayment ? '' : `
        <div class="detail-row remaining-amount">
          <span class="detail-label">Остаток к оплате:</span>
          <span class="detail-value">${booking.remainingAmount} USDT</span>
        </div>
        <div class="detail-note">
          Остаток необходимо оплатить перед консультацией
        </div>
  `;

  // Создаём блок успеха
  const successHtml = `
    <div class="success-container">
      <div class="success-icon">✅</div>
      <h2 class="success-title">Запись создана!</h2>

      <div class="success-details">
        <div class="detail-row">
          <span class="detail-label">Услуга:</span>
          <span class="detail-value">${booking.serviceName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Дата:</span>
          <span class="detail-value">${booking.date}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Время:</span>
          <span class="detail-value">${booking.time} (МСК)</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${isFullPayment ? 'К оплате:' : 'Предоплата:'}</span>
          <span class="detail-value">${booking.prepayment} USDT</span>
        </div>
        ${remainingText}
      </div>

      <div class="payment-info-box">
        <div class="payment-info-title">💳 Информация для оплаты</div>
        <div class="payment-field">
          <div class="payment-label">Адрес кошелька (USDT TON):</div>
          <div class="payment-value" id="success-wallet">${TON_WALLET}</div>
          <button class="copy-btn" onclick="copyToClipboard('${TON_WALLET}'); tg.showAlert('Адрес скопирован!');">📋</button>
        </div>
        <div class="payment-field">
          <div class="payment-label">Комментарий (ОБЯЗАТЕЛЬНО!):</div>
          <div class="payment-value payment-memo" id="success-memo">${booking.paymentMemo}</div>
          <button class="copy-btn" onclick="copyToClipboard('${booking.paymentMemo}'); tg.showAlert('Комментарий скопирован!');">📋</button>
        </div>
      </div>

      <div class="warning-box">
        ⚠️ Отправьте <b>USDT в сети TON</b> с указанием комментария.<br>
        Без комментария платёж не будет зачислен!
      </div>

      <button class="button button-primary" onclick="goToMyBookings()">Перейти к записям</button>
    </div>
  `;

  // Показываем в booking-flow
  const bookingFlow = document.getElementById('booking-flow');
  bookingFlow.innerHTML = successHtml;

  // Перезагружаем записи для вкладки "Мои записи"
  loadUserBookings();
}

// Переход к вкладке "Мои записи" после успешного создания бронирования
function goToMyBookings() {
  // Скрываем booking-flow
  document.getElementById('booking-flow').classList.add('hidden');

  // Показываем основные табы
  document.querySelector('.tabs-nav').classList.remove('hidden');
  document.getElementById('tab-consultations').classList.add('hidden');
  document.getElementById('tab-bookings').classList.remove('hidden');
  document.getElementById('tab-referrals').classList.add('hidden');

  // Обновляем активную вкладку
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tab === 'bookings') {
      btn.classList.add('active');
    }
  });

  state.currentTab = 'bookings';

  // Перезагружаем записи
  loadUserBookings();
}

function showDateSelection() {
  updateSteps(1);
  document.getElementById('time-selection').classList.add('hidden');
  document.getElementById('confirmation-step').classList.add('hidden');
  document.getElementById('date-selection').classList.remove('hidden');
}

// ===================
// UTILITY FUNCTIONS
// ===================

function setupEventListeners() {
  // Навигация по месяцам
  document.getElementById('prev-month').addEventListener('click', () => {
    state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
    renderCalendar();
  });

  // Кнопки навигации между шагами
  document.getElementById('back-to-services').addEventListener('click', showServiceSelection);
  document.getElementById('continue-to-time').addEventListener('click', showTimeSelection);
  document.getElementById('back-to-date').addEventListener('click', showDateSelection);
  document.getElementById('continue-to-confirm').addEventListener('click', showConfirmation);
  document.getElementById('back-to-time').addEventListener('click', showTimeSelection);
  document.getElementById('confirm-booking').addEventListener('click', confirmBooking);

  // Копирование кошелька
  document.getElementById('copy-wallet').addEventListener('click', () => {
    copyToClipboard(TON_WALLET);
    tg.showAlert('Адрес скопирован!');
  });

  // Копирование MEMO
  document.getElementById('copy-memo').addEventListener('click', () => {
    if (state.paymentMemo) {
      copyToClipboard(state.paymentMemo);
      tg.showAlert('Комментарий скопирован!');
    }
  });

  // Промокод
  document.getElementById('apply-promo').addEventListener('click', applyPromoCode);
  document.getElementById('promo-code').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      applyPromoCode();
    }
  });
}

function updateSteps(currentStep) {
  const connectors = document.querySelectorAll('.step-connector');

  for (let i = 1; i <= 3; i++) {
    const step = document.getElementById(`step-${i}`);
    step.classList.remove('active', 'completed');

    if (i < currentStep) {
      step.classList.add('completed');
    } else if (i === currentStep) {
      step.classList.add('active');
    }
  }

  connectors.forEach((conn, index) => {
    if (index < currentStep - 1) {
      conn.classList.add('completed');
    } else {
      conn.classList.remove('completed');
    }
  });
}

function showLoader() {
  document.getElementById('loader').classList.remove('hidden');
}

function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

// ===================
// PROMO CODE
// ===================

async function applyPromoCode() {
  const promoInput = document.getElementById('promo-code');
  const promoBtn = document.getElementById('apply-promo');
  const promoResult = document.getElementById('promo-result');
  const promoDiscount = document.getElementById('promo-discount');
  const promoFinal = document.getElementById('promo-final');

  const code = promoInput.value.trim().toUpperCase();

  if (!code) {
    showPromoError('Введите промокод');
    return;
  }

  if (!state.telegramId) {
    console.error('telegramId не установлен. initDataUnsafe:', tg.initDataUnsafe);
    showPromoError('Ошибка: откройте приложение через кнопку в боте');
    return;
  }

  // Блокируем кнопку на время запроса
  promoBtn.disabled = true;
  promoBtn.textContent = '...';

  try {
    const response = await fetch('/api/promo/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code,
        serviceId: state.serviceId,
        telegramId: state.telegramId
      })
    });

    const result = await response.json();

    if (result.valid && result.promoCode) {
      // Промокод валиден
      state.appliedPromoCode = result.promoCode;

      // Рассчитываем скидку (state.originalPrepayment и state.currentPaymentAmount в ЦЕНТАХ)
      // originalPrepayment = текущая сумма без скидки в центах
      const originalAmountCents = state.currentPaymentAmount; // в центах
      const discountAmountCents = Math.round(originalAmountCents * result.promoCode.discountPercent / 100);
      const discountedAmountCents = originalAmountCents - discountAmountCents;

      state.originalPrepayment = originalAmountCents; // в центах
      state.discountedPrepayment = discountedAmountCents; // в центах

      // Показываем результат
      promoResult.textContent = `Промокод ${result.promoCode.code} применён! Скидка ${result.promoCode.discountPercent}%`;
      promoResult.className = 'promo-result success';
      promoResult.classList.remove('hidden');

      // Показываем скидку (конвертируем центы в доллары для отображения)
      document.getElementById('discount-value').textContent = `-${(discountAmountCents / 100).toFixed(0)} USDT`;
      promoDiscount.classList.remove('hidden');

      // Показываем итоговую сумму (конвертируем центы в доллары для отображения)
      document.getElementById('final-prepayment').textContent = `${(discountedAmountCents / 100).toFixed(0)} USDT`;
      promoFinal.classList.remove('hidden');

      // Обновляем сумму в инструкции (центы -> доллары, без дробной части)
      document.getElementById('ton-amount').textContent = (discountedAmountCents / 100).toFixed(0);

      // Перечёркиваем старую сумму
      document.getElementById('confirm-prepayment').classList.add('price-strikethrough');

      // Блокируем ввод
      promoInput.disabled = true;
      promoBtn.textContent = 'Применён';
    } else {
      // Ошибка валидации
      showPromoError(result.error || 'Недействительный промокод');
    }
  } catch (error) {
    console.error('Promo code error:', error);
    showPromoError('Ошибка при проверке промокода');
  } finally {
    if (!state.appliedPromoCode) {
      promoBtn.disabled = false;
      promoBtn.textContent = 'Применить';
    }
  }
}

function showPromoError(message) {
  const promoResult = document.getElementById('promo-result');
  promoResult.textContent = message;
  promoResult.className = 'promo-result error';
  promoResult.classList.remove('hidden');
}

function resetPromoCode() {
  state.appliedPromoCode = null;
  state.discountedPrepayment = 0;

  const promoInput = document.getElementById('promo-code');
  const promoBtn = document.getElementById('apply-promo');
  const promoResult = document.getElementById('promo-result');
  const promoDiscount = document.getElementById('promo-discount');
  const promoFinal = document.getElementById('promo-final');

  promoInput.value = '';
  promoInput.disabled = false;
  promoBtn.disabled = false;
  promoBtn.textContent = 'Применить';
  promoResult.classList.add('hidden');
  promoDiscount.classList.add('hidden');
  promoFinal.classList.add('hidden');

  document.getElementById('confirm-prepayment').classList.remove('price-strikethrough');
}
