/* main.js
   Page behaviour for the portfolio: scroll reveal, counters, scroll progress,
   nav state, mobile menu, and the resume modal.

   Deliberately small. The intro overlay, the 3D card tilt and the animated
   neural-field canvas were removed with the paper redesign: the first screen is
   meant to be read, not watched.

   No inline script and no inline event handlers anywhere in index.html, so the
   Content-Security-Policy in vercel.json can refuse inline <script> outright.

   Everything degrades: if a node is missing the block returns instead of
   throwing, and every motion effect is skipped under prefers-reduced-motion.
*/

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Microsoft Clarity ──
     Loaded here rather than as an inline <script> in the document head so that
     script-src does not need 'unsafe-inline'. */
  const initClarity = (projectId) => {
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.clarity.ms/tag/' + projectId;
    document.head.appendChild(tag);
  };

  /* ── Scroll reveal ── */
  const REVEAL_SELECTOR =
    '.section-eyebrow, .section-title, .section-sub, ' +
    '.exp-card, .proj-card, .edu-card, .blog-card, .skill-group, .achievement-grid, ' +
    '.contact-intro, .contact-link';

  const initReveal = () => {
    document.querySelectorAll(REVEAL_SELECTOR).forEach((el) => {
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
    });

    const targets = document.querySelectorAll('[data-reveal]');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    targets.forEach((el) => io.observe(el));
  };

  /* ── Animated counters ── */
  const initCounters = () => {
    const counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    const settle = (el) => {
      el.textContent = el.dataset.count + (el.dataset.suffix || '');
    };

    if (reduceMotion || !('IntersectionObserver' in window)) {
      counters.forEach(settle);
      return;
    }

    const animate = (el) => {
      const target = parseFloat(el.dataset.count);
      if (!Number.isFinite(target)) { settle(el); return; }

      const suffix = el.dataset.suffix || '';
      const decimals = (el.dataset.count.split('.')[1] || '').length;
      const duration = 1400;
      const start = performance.now();

      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(decimals) + (p === 1 ? suffix : '');
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        animate(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.4 });

    counters.forEach((el) => io.observe(el));
  };

  /* ── Scroll progress bar ── */
  const initScrollProgress = () => {
    const bar = document.getElementById('scroll-progress');
    if (!bar) return;

    let queued = false;
    const paint = () => {
      queued = false;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      bar.style.width = (max > 0 ? (doc.scrollTop / max) * 100 : 0) + '%';
    };

    window.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    }, { passive: true });

    paint();
  };

  /* ── Nav: active section + mobile menu ── */
  const initNav = () => {
    const sections = [...document.querySelectorAll('main.page > section[id]')];
    const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];

    if (sections.length && links.length && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((a) => {
            const active = a.getAttribute('href') === '#' + e.target.id;
            a.classList.toggle('active', active);
            if (active) a.setAttribute('aria-current', 'true');
            else a.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

      sections.forEach((s) => io.observe(s));
    }

    const burger = document.getElementById('hamburger');
    const menu = document.getElementById('navLinks');
    if (!burger || !menu) return;

    const setMenu = (open) => {
      burger.classList.toggle('active', open);
      menu.classList.toggle('mobile-open', open);
      burger.setAttribute('aria-expanded', String(open));
    };

    burger.addEventListener('click', () => {
      setMenu(!menu.classList.contains('mobile-open'));
    });
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('mobile-open')) {
        setMenu(false);
        burger.focus();
      }
    });
  };

  /* ── Resume modal ──
     Focus is moved in on open, trapped while open, and returned to the trigger
     on close. Escape closes. Backdrop click closes. */
  const initResumeModal = () => {
    const modal = document.getElementById('resumeModal');
    const triggers = [...document.querySelectorAll('[data-resume-open]')];
    if (!modal || !triggers.length) return;

    const closeBtn = modal.querySelector('.modal-close');
    const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let lastFocused = null;

    const open = () => {
      lastFocused = document.activeElement;
      modal.classList.add('open');
      modal.removeAttribute('aria-hidden');
      triggers.forEach((t) => t.setAttribute('aria-expanded', 'true'));
      const first = modal.querySelector(FOCUSABLE);
      if (first) first.focus();
    };

    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));
      if (lastFocused instanceof HTMLElement) lastFocused.focus();
    };

    const trap = (e) => {
      if (e.key !== 'Tab') return;
      const items = [...modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    triggers.forEach((t) => t.addEventListener('click', open));
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else trap(e);
    });
  };

  /* ── Boot ── */
  initClarity('xf1dtnla6j');
  initReveal();
  initCounters();
  initScrollProgress();
  initNav();
  initResumeModal();
})();
