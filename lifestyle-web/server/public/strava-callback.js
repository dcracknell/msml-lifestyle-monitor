const closeButton = document.getElementById('closeWindowButton');

if (closeButton) {
  closeButton.addEventListener('click', () => {
    window.close();
  });
}

if (window.opener) {
  window.opener.postMessage({ type: 'strava:connected' }, '*');
  setTimeout(() => window.close(), 1500);
}
