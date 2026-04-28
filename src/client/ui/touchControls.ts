import type { InputManager } from '../input'

export class TouchControls {
  private el: HTMLElement
  private input: InputManager

  constructor(input: InputManager) {
    this.input = input

    this.el = document.createElement('div')
    this.el.id = 'touch-controls'
    this.el.innerHTML = `
      <div class="tc-left">
        <div class="tc-dpad">
          <div class="tc-dpad-cell"></div>
          <button class="tc-btn tc-dpad-btn" data-key="KeyW">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 6l-7 8h14z" fill="currentColor"/></svg>
          </button>
          <div class="tc-dpad-cell"></div>
          <button class="tc-btn tc-dpad-btn" data-key="KeyA">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 12l8-7v14z" fill="currentColor"/></svg>
          </button>
          <div class="tc-dpad-center"></div>
          <button class="tc-btn tc-dpad-btn" data-key="KeyD">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M18 12l-8-7v14z" fill="currentColor"/></svg>
          </button>
          <div class="tc-dpad-cell"></div>
          <button class="tc-btn tc-dpad-btn" data-key="KeyS">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 18l7-8H5z" fill="currentColor"/></svg>
          </button>
          <div class="tc-dpad-cell"></div>
        </div>
        <button class="tc-btn tc-jump" data-action="jump">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3l-7 10h5v8h4v-8h5z" fill="currentColor"/></svg>
          JUMP
        </button>
      </div>

      <div class="tc-right">
        <div class="tc-aim-pad">
          <div class="tc-dpad-cell"></div>
          <button class="tc-btn tc-aim-btn" data-key="ArrowUp">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="tc-dpad-cell"></div>
          <button class="tc-btn tc-aim-btn" data-key="ArrowLeft">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="tc-aim-center">AIM</div>
          <button class="tc-btn tc-aim-btn" data-key="ArrowRight">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="tc-dpad-cell"></div>
          <button class="tc-btn tc-aim-btn" data-key="ArrowDown">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="tc-dpad-cell"></div>
        </div>
        <div class="tc-fire-col">
          <button class="tc-btn tc-fire" data-action="fire">FIRE</button>
          <div class="tc-util-row">
            <button class="tc-btn tc-weapon" data-action="weapon">WPN</button>
            <button class="tc-btn tc-end" data-action="endTurn">END</button>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(this.el)

    // Only show on actual mobile/tablet — coarse pointer means touch-primary device
    const isTouchPrimary = matchMedia('(pointer: coarse)').matches
    if (isTouchPrimary) {
      this.el.style.display = 'flex'
      document.body.classList.add('has-touch')
    }

    this.bindEvents()
  }

  private bindEvents(): void {
    const buttons = this.el.querySelectorAll('.tc-btn')

    buttons.forEach(btn => {
      const key = btn.getAttribute('data-key')
      const action = btn.getAttribute('data-action')

      if (key) {
        btn.addEventListener('touchstart', (e) => {
          e.preventDefault()
          this.input.setTouchKey(key, true)
          btn.classList.add('tc-active')
        }, { passive: false })

        btn.addEventListener('touchend', (e) => {
          e.preventDefault()
          this.input.setTouchKey(key, false)
          btn.classList.remove('tc-active')
        }, { passive: false })

        btn.addEventListener('touchcancel', () => {
          this.input.setTouchKey(key, false)
          btn.classList.remove('tc-active')
        })

        btn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          this.input.setTouchKey(key, true)
          btn.classList.add('tc-active')
        })

        btn.addEventListener('mouseup', () => {
          this.input.setTouchKey(key, false)
          btn.classList.remove('tc-active')
        })

        btn.addEventListener('mouseleave', () => {
          this.input.setTouchKey(key, false)
          btn.classList.remove('tc-active')
        })
      }

      if (action === 'fire') {
        btn.addEventListener('touchstart', (e) => {
          e.preventDefault()
          this.input.startChargeOrPick()
          btn.classList.add('tc-active')
        }, { passive: false })

        btn.addEventListener('touchend', (e) => {
          e.preventDefault()
          this.input.releaseCharge()
          btn.classList.remove('tc-active')
        }, { passive: false })

        btn.addEventListener('touchcancel', () => {
          this.input.releaseCharge()
          btn.classList.remove('tc-active')
        })

        btn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          this.input.startChargeOrPick()
          btn.classList.add('tc-active')
        })

        btn.addEventListener('mouseup', () => {
          this.input.releaseCharge()
          btn.classList.remove('tc-active')
        })

        btn.addEventListener('mouseleave', () => {
          if (btn.classList.contains('tc-active')) {
            this.input.releaseCharge()
            btn.classList.remove('tc-active')
          }
        })
      }

      if (action === 'jump') {
        const handler = (e: Event) => { e.preventDefault(); this.input.triggerJump() }
        btn.addEventListener('touchstart', handler, { passive: false })
        btn.addEventListener('mousedown', handler)
      }

      if (action === 'weapon') {
        const handler = (e: Event) => { e.preventDefault(); this.input.cycleWeapon(1) }
        btn.addEventListener('touchstart', handler, { passive: false })
        btn.addEventListener('mousedown', handler)
      }

      if (action === 'endTurn') {
        const handler = (e: Event) => { e.preventDefault(); this.input.triggerEndTurn() }
        btn.addEventListener('touchstart', handler, { passive: false })
        btn.addEventListener('mousedown', handler)
      }
    })
  }

  dispose(): void {
    this.el.remove()
  }
}
