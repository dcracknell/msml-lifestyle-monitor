window.__MSML_AUTH_READY = false;

const AUTH_FORM_FEEDBACK_IDS = {
  loginForm: 'loginFeedback',
  signupForm: 'signupFeedback',
  forgotForm: 'forgotFeedback',
};

function setAuthGuardFeedback(formId, message) {
  const feedbackId = AUTH_FORM_FEEDBACK_IDS[formId];
  if (!feedbackId) {
    return;
  }
  const feedback = document.getElementById(feedbackId);
  if (feedback) {
    feedback.textContent = message;
  }
}

document.addEventListener(
  'submit',
  (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    if (!AUTH_FORM_FEEDBACK_IDS[form.id] || window.__MSML_AUTH_READY === true) {
      return;
    }

    event.preventDefault();
    setAuthGuardFeedback(form.id, 'Page is still loading. Wait a moment, then try again.');
  },
  true
);

document.addEventListener(
  'click',
  (event) => {
    const button = event.target.closest('[data-auth-submit]');
    if (!button || window.__MSML_AUTH_READY === true) {
      return;
    }

    event.preventDefault();
    const form = button.closest('form');
    if (form?.id) {
      setAuthGuardFeedback(form.id, 'Page is still loading. Wait a moment, then try again.');
    }
  },
  true
);
