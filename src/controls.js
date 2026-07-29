/* Input: pointer-lock mouse-look and WASD on desktop, a thumbstick plus
   drag-to-look on touch. Both feed the same little state object. */

const Controls = {
  keys: Object.create(null),
  look: { x: 0, y: 0 },
  move: { x: 0, y: 0 },
  locked: false,
  sensitivity: 0.0022,
  jumpQueued: false,
  onLockChange: null,

  init(canvas) {
    this.canvas = canvas;

    window.addEventListener('keydown', (event) => {
      this.keys[event.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => { this.keys[event.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.look.x += event.movementX * this.sensitivity;
      this.look.y += event.movementY * this.sensitivity;
    });

    this.initTouch();
  },

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  },

  tapJump() {
    this.jumpQueued = true;
  },

  initTouch() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const surface = document.getElementById('look-area');
    if (!stick || !surface) return;

    const RADIUS = 46;
    let stickId = null;
    let lookId = null;
    let last = { x: 0, y: 0 };
    let origin = { x: 0, y: 0 };

    stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      stickId = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      const box = stick.getBoundingClientRect();
      origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });

    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== stickId) return;
      let dx = event.clientX - origin.x;
      let dy = event.clientY - origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > RADIUS) {
        dx = (dx / distance) * RADIUS;
        dy = (dy / distance) * RADIUS;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = dx / RADIUS;
      this.move.y = -dy / RADIUS;
    });

    const dropStick = (event) => {
      if (event.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = 'translate(0px, 0px)';
      this.move.x = 0;
      this.move.y = 0;
    };
    stick.addEventListener('pointerup', dropStick);
    stick.addEventListener('pointercancel', dropStick);

    surface.addEventListener('pointerdown', (event) => {
      if (lookId !== null) return;
      lookId = event.pointerId;
      surface.setPointerCapture(event.pointerId);
      last = { x: event.clientX, y: event.clientY };
    });

    surface.addEventListener('pointermove', (event) => {
      if (event.pointerId !== lookId) return;
      this.look.x += (event.clientX - last.x) * 0.005;
      this.look.y += (event.clientY - last.y) * 0.005;
      last = { x: event.clientX, y: event.clientY };
    });

    const dropLook = (event) => {
      if (event.pointerId !== lookId) return;
      lookId = null;
    };
    surface.addEventListener('pointerup', dropLook);
    surface.addEventListener('pointercancel', dropLook);
  },

  sample() {
    const keys = this.keys;
    let x = this.move.x;
    let y = this.move.y;

    if (keys.KeyW || keys.ArrowUp) y += 1;
    if (keys.KeyS || keys.ArrowDown) y -= 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;

    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }

    const look = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;

    const jump = Boolean(keys.Space) || this.jumpQueued;
    this.jumpQueued = false;

    return { x, y, look, jump, sprint: Boolean(keys.ShiftLeft || keys.ShiftRight) };
  },
};
