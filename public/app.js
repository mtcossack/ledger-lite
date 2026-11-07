'use strict';

const byId = (id) => document.getElementById(id);
const app = byId('app');
const loginPage = byId('login');
let data = null;
let selectedId = null;
let busy = false;
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const integer = new Intl.NumberFormat('en-US');

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: options.body ? {'content-type': 'application/json'} : undefined,
  });
  if (!res.ok) {
    let message = 'Something went wrong';
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
const send = (path, method, value = {}) => api(path, {method,body:JSON.stringify(value)});
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function notify(message, target = 'app-error') {
  const node = byId(target);
  node.textContent = message;
  node.hidden = !message;
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button')) element.disabled = value;
}
function showLogin() {
  app.hidden = true;
  loginPage.hidden = false;
  byId('loading').hidden = true;
}
function showApp() {
  loginPage.hidden = true;
  app.hidden = false;
  byId('loading').hidden = true;
}
async function reload() {
  data = await api('/api/state');
  if (!data.people.some(person => person.id === selectedId)) selectedId = data.people[0]?.id || null;
  render();
}
function currentPerson() { return data.people.find(person => person.id === selectedId); }
function balance(kind) {
  return data.balances.find(item => item.person_id === selectedId && item.category === kind)?.balance || 0;
}
function renderPeople() {
  const people = byId('people');
  people.replaceChildren();
  byId('no-people').hidden = data.people.length !== 0;
  for (const person of data.people) {
    const btn = el('button', 'person-tab', person.name);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(person.id === selectedId));
    btn.addEventListener('click', () => { selectedId = person.id; render(); });
    people.append(btn);
  }
}
function renderBalances() {
  const grid = byId('balance-cards');
  grid.replaceChildren();
  for (const [kind, title, unit] of [
    ['money', 'Money balance', 'USD'],['points', 'Points balance', 'points'],['screen', 'Screen time', 'minutes'],
  ]) {
    const card = el('div','balance-card');
    card.append(el('div','balance-name', title));
    card.append(el('div','balance-value', kind === 'money' ? currency.format(balance(kind) / 100) : integer.format(balance(kind))));
    card.append(el('div','balance-unit', unit));
    grid.append(card);
  }
}
function renderHistory() {
  const target = byId('entries');
  target.replaceChildren();
  const category = byId('history-filter').value;
  const entries = data.entries.filter(item => item.person_id === selectedId && (category === 'all' || item.category === category));
  byId('no-entries').hidden = entries.length > 0;
  for (const item of entries) {
    const row = el('article', 'entry');
    const left = el('div');
    left.append(el('div', 'entry-note', item.note));
    left.append(el('div', 'entry-meta', `${new Date(item.created_at).toLocaleString()} · ${item.entered_by_name}`));
    const right = el('div', 'entry-right');
    const sign = item.delta > 0 ? '+' : '−';
    const magnitude = Math.abs(item.delta);
    right.append(el('div', `entry-delta ${item.delta > 0 ? 'pos' : 'neg'}`,
      `${sign}${item.category === 'money' ? currency.format(magnitude / 100) : integer.format(magnitude)}`));
    right.append(el('div', 'entry-type', item.category === 'screen' ? 'minutes' : item.category));
    row.append(left,right);
    target.append(row);
  }
}
function render() {
  byId('greeting').textContent = data.user.name;
  renderPeople();
  const person = currentPerson();
  byId('ledger-content').hidden = !person;
  if (person) {
    byId('selected-name').textContent = person.name;
    renderBalances();
    renderHistory();
  }
}
function amountToInteger(raw, category) {
  const input = raw.trim();
  if (category === 'money') {
    if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(input)) throw new Error('Use a positive amount, up to $999,999.99');
    const [whole, fraction = ''] = input.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
    if (cents <= 0) throw new Error('Amount must be greater than zero');
    return cents;
  }
  if (!/^[1-9]\d{0,7}$/.test(input)) throw new Error('Enter a positive whole number');
  return Number(input);
}

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  notify('', 'login-error');
  setBusy(true);
  try {
    await send('/api/login', 'POST', {email:byId('email').value, password:byId('password').value});
    byId('password').value = '';
    await reload();
    showApp();
  } catch (error) { notify(error.message, 'login-error'); }
  finally { setBusy(false); }
});
byId('sign-out').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try { await send('/api/logout','POST'); data = null; showLogin(); }
  catch (error) { notify(error.message); }
  finally { setBusy(false); }
});
byId('add-person-toggle').addEventListener('click', () => { byId('add-person-form').hidden = false; byId('new-person').focus(); });
byId('add-person-cancel').addEventListener('click', () => { byId('add-person-form').hidden = true; byId('new-person').value = ''; });
byId('add-person-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  setBusy(true); notify('');
  try {
    const result = await send('/api/people','POST',{name:byId('new-person').value});
    selectedId = result.id;
    byId('new-person').value = '';
    byId('add-person-form').hidden = true;
    await reload();
  } catch (error) { notify(error.message); }
  finally { setBusy(false); }
});
byId('rename-person').addEventListener('click', async () => {
  const current = currentPerson();
  if (!current || busy) return;
  const name = window.prompt('New name',current.name);
  if (name === null || name.trim() === current.name) return;
  setBusy(true); notify('');
  try { await send(`/api/people/${current.id}`,'PATCH',{name}); await reload(); }
  catch (error) { notify(error.message); }
  finally { setBusy(false); }
});
byId('entry-category').addEventListener('change', () => {
  const type = byId('entry-category').value;
  byId('amount-label').textContent = type === 'money' ? 'Amount ($)' : type === 'points' ? 'Points' : 'Minutes';
  byId('entry-amount').placeholder = type === 'money' ? '0.00' : '0';
  byId('entry-amount').value = '';
});
byId('entry-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!currentPerson() || busy) return;
  setBusy(true); notify('');
  try {
    const category = byId('entry-category').value;
    const amount = amountToInteger(byId('entry-amount').value, category);
    const direction = document.querySelector('input[name="direction"]:checked').value;
    await send('/api/entries','POST',{
      personId:selectedId, category, delta:direction === 'subtract' ? -amount : amount,
      note:byId('entry-note').value,
    });
    byId('entry-amount').value = ''; byId('entry-note').value = '';
    await reload();
  } catch (error) { notify(error.message); }
  finally { setBusy(false); }
});
byId('history-filter').addEventListener('change', () => {if (data) renderHistory();});
byId('export').addEventListener('click', () => { window.location.href='/api/export'; });

(async () => {
  try { await reload(); showApp(); }
  catch (error) {
    if (error.status === 401) showLogin();
    else { showLogin(); notify(error.message,'login-error'); }
  }
})();
