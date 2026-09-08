/* main.js
   Page behaviour for the portfolio: intro, scroll reveal, counters, nav state,
   mobile menu, card tilt, resume modal, and the neural background field.

   No inline script and no inline event handlers anywhere in index.html, so the
   Content-Security-Policy in vercel.json can refuse inline <script> outright.

   Everything degrades: if a node is missing the block returns instead of
   throwing, and every motion effect is skipped under prefers-reduced-motion.
*/

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

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

  /* ── Cinematic intro ──
     Shown once per session. Dismissed by click, by Escape, or on a timer. */
  const initIntro = () => {
    const intro = document.getElementById('intro');
    if (!intro) return;

    let seen = false;
    try { seen = sessionStorage.getItem('introSeen') === '1'; } catch { /* storage blocked */ }

    if (reduceMotion || seen) { intro.remove(); return; }
    try { sessionStorage.setItem('introSeen', '1'); } catch { /* storage blocked */ }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let done = false;
    const dismiss = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      intro.classList.add('gone');
      document.body.style.overflow = prevOverflow;
      setTimeout(() => intro.remove(), 700);
    };
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };

    const timer = setTimeout(dismiss, 2400);
    intro.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey);
  };

  /* ── Scroll reveal ── */
  const REVEAL_SELECTOR =
    '.section-eyebrow, .section-title, .section-sub, .hero-left, .hero-sidebar, .hl-card, ' +
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
    const openBtn = document.getElementById('resumeOpen');
    if (!modal || !openBtn) return;

    const closeBtn = modal.querySelector('.modal-close');
    const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let lastFocused = null;

    const open = () => {
      lastFocused = document.activeElement;
      modal.classList.add('open');
      modal.removeAttribute('aria-hidden');
      openBtn.setAttribute('aria-expanded', 'true');
      const first = modal.querySelector(FOCUSABLE);
      if (first) first.focus();
    };

    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      openBtn.setAttribute('aria-expanded', 'false');
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

    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else trap(e);
    });
  };

  /* ── 3D tilt on cards ── */
  const TILT_SELECTOR =
    '.hl-card, .exp-card, .edu-card, .blog-card, .skill-group, .achievement-grid, .hero-sidebar';

  const initTilt = () => {
    if (reduceMotion || !canHover) return;

    document.querySelectorAll(TILT_SELECTOR).forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg) translateY(-4px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  };

  /* ── Neural background field ──
     The animation loop stops when the tab is hidden, so a backgrounded page
     costs nothing. Node count scales with viewport area and is capped. */
  const initNeuralField = () => {
    const canvas = document.getElementById('neural-bg');
    if (!canvas || reduceMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const LINK_DIST = 124;
    const MAX_NODES = 78;
    const mouse = { x: -9999, y: -9999 };
    let width = 0, height = 0, nodes = [], frame = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(MAX_NODES, Math.floor((width * height) / 21000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22
      }));
    };

    const step = () => {
      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;

        const d = Math.hypot(n.x - mouse.x, n.y - mouse.y);
        if (d < 150 && d > 0) {
          n.x += ((n.x - mouse.x) / d) * 0.7;
          n.y += ((n.y - mouse.y) / d) * 0.7;
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d >= LINK_DIST) continue;
          ctx.strokeStyle = `rgba(245,181,68,${(1 - d / LINK_DIST) * 0.15})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        const near = Math.hypot(n.x - mouse.x, n.y - mouse.y) < LINK_DIST;
        ctx.fillStyle = near ? 'rgba(255,200,87,.9)' : 'rgba(245,181,68,.4)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, near ? 2.4 : 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      frame = requestAnimationFrame(step);
    };

    const start = () => { if (frame === null) frame = requestAnimationFrame(step); };
    const stop = () => { if (frame !== null) { cancelAnimationFrame(frame); frame = null; } };

    resize();
    start();

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseout', () => { mouse.x = mouse.y = -9999; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });
  };

  /* ── Boot ── */
  initClarity('xf1dtnla6j');
  initIntro();
  initReveal();
  initCounters();
  initScrollProgress();
  initNav();
  initResumeModal();
  initTilt();
  initNeuralField();
})();
