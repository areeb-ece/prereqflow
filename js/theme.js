/* Offline fallback for the light/dark sheet and the motion switch. Online, /design/theme.js
   (loaded just before this) has already applied the visitor's shared settings and this does nothing. */
try {
  if (!window.SiteDesign) {
    const t = localStorage.getItem("prereqflow.theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    if (localStorage.getItem("prereqflow.motion") === "off") document.documentElement.dataset.motion = "off";
  }
} catch (e) {}
