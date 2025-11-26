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
  paymentMemo: null
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

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  // Получаем данные пользователя из Telegram
  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    state.telegramId = tg.initDataUnsafe.user.id;
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

    return `
      <div class="booking-card">
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
      </div>
    `;
  }).join('');
}

// ===================
// REFERRALS
// ===================

async function loadUserData() {
  if (!state.telegramId) return;

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

  // Загружаем MEMO для платежа
  await loadPaymentMemo();
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

function confirmBooking() {
  const dateStr = formatDateISO(state.selectedDate);

  const data = {
    serviceId: state.serviceId,
    slotId: state.selectedSlot.id,
    date: dateStr,
    startTime: state.selectedSlot.startTime,
    endTime: state.selectedSlot.endTime
  };

  // Добавляем промокод если применён
  if (state.appliedPromoCode) {
    data.promoCode = state.appliedPromoCode.code;
    data.promoCodeId = state.appliedPromoCode.id;
    data.discountPercent = state.appliedPromoCode.discountPercent;
  }

  // Отправляем данные в бот
  tg.sendData(JSON.stringify(data));
  tg.close();
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
    showPromoError('Ошибка: не удалось определить пользователя');
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

      // Рассчитываем скидку
      const discountAmount = Math.round(state.originalPrepayment * result.promoCode.discountPercent / 100);
      state.discountedPrepayment = state.originalPrepayment - discountAmount;

      // Показываем результат
      promoResult.textContent = `Промокод ${result.promoCode.code} применён! Скидка ${result.promoCode.discountPercent}%`;
      promoResult.className = 'promo-result success';
      promoResult.classList.remove('hidden');

      // Показываем скидку
      document.getElementById('discount-value').textContent = `-${(discountAmount / 100).toFixed(2)} USDT`;
      promoDiscount.classList.remove('hidden');

      // Показываем итоговую сумму
      document.getElementById('final-prepayment').textContent = `${(state.discountedPrepayment / 100).toFixed(2)} USDT`;
      promoFinal.classList.remove('hidden');

      // Обновляем сумму в инструкции
      document.getElementById('ton-amount').textContent = (state.discountedPrepayment / 100).toFixed(2);

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
