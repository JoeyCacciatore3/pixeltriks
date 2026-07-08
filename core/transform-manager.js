
/* ============================================================
   PixelTriks — transform-manager.js
   The Single Source of Truth for all object transformations.

   Timestamp: 2026-07-08T16:34:00Z
   Owner: Nate
   ============================================================ */
'use strict';
window.GF = window.GF || {};

class TransformManager {
    constructor() {
        this.state = 'idle'; // e.g., 'idle', 'dragging', 'rotating', 'scaling'
        this.activeObject = null;
    }

    /**
     * The main entry point for all transformation requests.
     * @param {Object} target The object to transform.
     * @param {Object} transform The transformation to apply.
     * @param {string} source The source of the request (e.g., 'gizmo', 'transform-pad').
     */
    requestTransform(target, transform, source) {
        // Basic state management to prevent conflicts.
        // More sophisticated logic will be added here.
        if (this.state !== 'idle' && this.state !== source) {
            console.warn(`TransformManager: Blocked request from '${source}' due to active state '${this.state}'.`);
            return;
        }

        this.activeObject = target;
        this.state = source;

        // Apply the transformation
        if (transform.position) {
            this.applyPosition(target, transform.position);
        }
        if (transform.rotation) {
            this.applyRotation(target, transform.rotation);
        }
        if (transform.scale) {
            this.applyScale(target, transform.scale);
        }

        // For now, we assume transforms are instant.
        // We will add logic for start/end of transforms.
        this.state = 'idle';

        // Notify other systems if needed
        window.dispatchEvent(new CustomEvent('pt:transform', { detail: { target, transform } }));
    }

    /**
     * A special variant for high-frequency updates from a direct-manipulation tool
     * like TransformControls. It bypasses the state check but sets the state.
     */
    requestRawTransform(target, transform, source) {
        this.activeObject = target;
        this.state = source;

        if (transform.position) this.applyPosition(target, transform.position);
        if (transform.rotation) this.applyRotation(target, transform.rotation);
        if (transform.scale) this.applyScale(target, transform.scale);

        window.dispatchEvent(new CustomEvent('pt:transform', { detail: { target, transform } }));
    }

    /**
     * Sets the state, particularly for starting/ending a manipulation sequence.
     */
    setState(newState) {
        this.state = newState;
    }



    applyPosition(target, pos) {
        if (pos.x !== undefined) target.position.x = pos.x;
        if (pos.y !== undefined) target.position.y = pos.y;
        if (pos.z !== undefined) target.position.z = pos.z;
    }

    applyRotation(target, rot) {
        if (rot.x !== undefined) target.rotation.x = rot.x;
        if (rot.y !== undefined) target.rotation.y = rot.y;
        if (rot.z !== undefined) target.rotation.z = rot.z;
    }

    applyScale(target, scale) {
        if (scale.x !== undefined) target.scale.x = scale.x;
        if (scale.y !== undefined) target.scale.y = scale.y;
        if (scale.z !== undefined) target.scale.z = scale.z;
    }
}

GF.transformManager = new TransformManager();
