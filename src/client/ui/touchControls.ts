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
        <div class="tc-move-row">
          <button class="tc-btn tc-move" data-key="ArrowLeft">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="tc-btn tc-jump" data-action="jump">JUMP</button>
          <button class="tc-btn tc-move" data-key="ArrowRight">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="tc-right">
        <div class="tc-aim-col">
          <button class="tc-btn tc-aim" data-key="ArrowUp">
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="tc-btn tc-aim" data-key="ArrowDown">
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <button class="tc-btn tc-fire" data-action="fire">FIRE</button>
        <div class="tc-util-col">
          <button class="tc-btn tc-weapon" data-action="weapon">WPN</button>
          <button class="tc-btn tc-end" data-action="endTurn">END</button>
        </div>
      </div>
    `

    document.body.appendChild(this.el)
    this.el.style.display = 'flex'
    document.body.classList.add('has-touch')
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
          this.input.startCharge()
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
          this.input.startCharge()
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
        const handler = (e: Event) => {
          e.preventDefault()
          this.input.triggerJump()
        }
        btn.addEventListener('touchstart', handler, { passive: false })
        btn.addEventListener('mousedown', handler)
      }

      if (action === 'weapon') {
        const handler = (e: Event) => {
          e.preventDefault()
          this.input.cycleWeapon(1)
        }
        btn.addEventListener('touchstart', handler, { passive: false })
        btn.addEventListener('mousedown', handler)
      }

      if (action === 'endTurn') {
        const handler = (e: Event) => {
          e.preventDefault()
          this.input.triggerEndTurn()
        }
        btn.addEventListener('touchstart', handler, { passive: false })
        btn.addEventListener('mousedown', handler)
      }
    })
  }
}
