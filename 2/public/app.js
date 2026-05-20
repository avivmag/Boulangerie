const form = document.querySelector("#claimForm");
const message = document.querySelector("#formMessage");
const couponPanel = document.querySelector("#couponPanel");
const couponCode = document.querySelector("#couponCode");
const submitButton = form.querySelector("button[type='submit']");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function showCoupon(code) {
  couponCode.textContent = code;
  couponPanel.classList.remove("is-hidden");
  couponPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const payload = {
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    marketingConsent: formData.get("marketingConsent") === "on"
  };

  submitButton.disabled = true;

  try {
    const response = await fetch("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (response.status === 409) {
      showCoupon(data.couponCode);
      setMessage("כבר מומשה הטבה עבור הטלפון או המייל הזה.", true);
      return;
    }

    if (!response.ok) {
      setMessage("לא הצלחנו לשמור את הפרטים. כדאי לבדוק שהכול מולא נכון.", true);
      return;
    }

    showCoupon(data.couponCode);
    setMessage("מעולה, ההטבה מוכנה להצגה לצוות.");
    form.reset();
  } catch {
    setMessage("יש בעיית חיבור רגעית. נסו שוב בעוד כמה שניות.", true);
  } finally {
    submitButton.disabled = false;
  }
});
