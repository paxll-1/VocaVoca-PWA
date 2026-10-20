export async function setupPwa(onStatus, pending) {
  const banner = document.querySelector('#update');
  let wasControlled = !!navigator.serviceWorker?.controller;
  let reloading = false;
  try {
    const version = await fetch('./version.json').then((r) => r.json());
    onStatus({ build: version.build });
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      onStatus({ status: 'Офлайн-доступ недоступен. Нужен HTTPS и браузер с поддержкой PWA.' });
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (wasControlled && !reloading) {
        reloading = true;
        await pending();
        location.reload();
      } else banner.hidden = true;
      wasControlled = true;
    });
    // Reuse an existing registration offline. A failed network registration must not prevent
    // listeners being attached to the worker which already serves the complete cached app.
    const registration =
      (await navigator.serviceWorker.getRegistration('./')) ||
      (await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }));
    function showUpdate(candidate = registration.waiting) {
      if (!candidate || candidate.state !== 'installed' || !navigator.serviceWorker.controller) return;
      banner.hidden = false;
      banner.replaceChildren(
        document.createTextNode('Новая версия готова. Сохранённый прогресс останется. '),
      );
      const button = document.createElement('button');
      button.textContent = 'Обновить';
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        await pending();
        (registration.waiting || candidate).postMessage({ type: 'ACTIVATE' });
      });
      banner.append(button);
    }
    showUpdate();
    function watch(worker) {
      if (!worker) return;
      const changed = () => {
        // Use the concrete worker: registration.waiting may be assigned just after statechange.
        if (worker.state === 'installed') showUpdate(worker);
        if (worker.state === 'redundant' && !registration.active)
          onStatus({ status: 'Офлайн-загрузка не завершена. Открой приложение снова с интернетом.' });
      };
      worker.addEventListener('statechange', changed);
      changed();
    }
    registration.addEventListener('updatefound', () => watch(registration.installing));
    watch(registration.installing);
    await navigator.serviceWorker.ready;
    onStatus({
      offline: true,
      status: 'Готово к работе без интернета. Карточки и шрифты сохранены на устройстве.',
    });
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => {});
    };
    check();
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();
    });
  } catch {
    onStatus({
      status: 'Не удалось подготовить офлайн-доступ. При следующем открытии с сетью попробуем снова.',
    });
  }
}
