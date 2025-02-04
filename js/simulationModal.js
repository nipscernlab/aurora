class SimulationModal {
  constructor() {
    this.modal = null;
    this.tbFiles = [];
    this.gtkwFiles = [];
    this.selectedTb = '';
    this.selectedGtkw = '';
    this.standardSimulation = false;
  }

  async show(hardwarePath) {
    // Read directory contents
    const files = await window.electronAPI.readDir(hardwarePath);
    this.tbFiles = files.filter(file => file.endsWith('_tb.v'));
    this.gtkwFiles = files.filter(file => file.endsWith('.gtkw'));

    return new Promise((resolve) => {
      this.createModal(resolve);
    });
  }

  createModal(resolve) {
    const modalHtml = `
      <div class="modal-overlay">
        <div class="modal-content">
          <h2 class="modal-title">Simulation Config</h2>
          
          <div class="modal-section">
            <h3 class="section-title">Testbench Files</h3>
            <div class="checkbox-list">
              ${this.tbFiles.map(file => `
                <label class="checkbox-item">
                  <input type="checkbox" name="tb" value="${file}" ${this.standardSimulation ? 'disabled' : ''}>
                  <span>${file}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="modal-section">
            <h3 class="section-title">GTKWave Files</h3>
            <div class="checkbox-list">
              ${this.gtkwFiles.map(file => `
                <label class="checkbox-item">
                  <input type="checkbox" name="gtkw" value="${file}" ${this.standardSimulation ? 'disabled' : ''}>
                  <span>${file}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="modal-section">
            <label class="checkbox-item">
              <input type="checkbox" name="standard" ${this.selectedTb || this.selectedGtkw ? 'disabled' : ''}>
              <span>Standard Simulation</span>
            </label>
          </div>

          <div class="modal-footer">
            <button class="btn btn-cancel">Cancel</button>
            <button class="btn btn-save" disabled>Save</button>
          </div>
        </div>
      </div>
    `;

    this.modal = document.createElement('div');
    this.modal.innerHTML = modalHtml;
    document.body.appendChild(this.modal);

    this.setupEventListeners(resolve);
  }

  setupEventListeners(resolve) {
    const tbCheckboxes = this.modal.querySelectorAll('input[name="tb"]');
    const gtkwCheckboxes = this.modal.querySelectorAll('input[name="gtkw"]');
    const standardCheckbox = this.modal.querySelector('input[name="standard"]');
    const saveButton = this.modal.querySelector('.btn-save');
    const cancelButton = this.modal.querySelector('.btn-cancel');

    // Handle testbench selection
    tbCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        tbCheckboxes.forEach(other => {
          if (other !== e.target) other.checked = false;
        });
        this.selectedTb = e.target.checked ? e.target.value : '';
        this.updateSaveButton(saveButton);
        standardCheckbox.disabled = this.selectedTb || this.selectedGtkw;
      });
    });

    // Handle gtkw selection
    gtkwCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        gtkwCheckboxes.forEach(other => {
          if (other !== e.target) other.checked = false;
        });
        this.selectedGtkw = e.target.checked ? e.target.value : '';
        this.updateSaveButton(saveButton);
        standardCheckbox.disabled = this.selectedTb || this.selectedGtkw;
      });
    });

    // Handle standard simulation
    standardCheckbox.addEventListener('change', (e) => {
      this.standardSimulation = e.target.checked;
      tbCheckboxes.forEach(cb => {
        cb.disabled = this.standardSimulation;
        cb.checked = false;
      });
      gtkwCheckboxes.forEach(cb => {
        cb.disabled = this.standardSimulation;
        cb.checked = false;
      });
      this.selectedTb = '';
      this.selectedGtkw = '';
      this.updateSaveButton(saveButton);
    });

    // Handle save
    saveButton.addEventListener('click', () => {
      const result = {
        standardSimulation: this.standardSimulation,
        selectedTb: this.selectedTb,
        selectedGtkw: this.selectedGtkw
      };
      this.closeModal();
      resolve(result);
    });

    // Handle cancel
    cancelButton.addEventListener('click', () => {
      this.closeModal();
      resolve(null);
    });
  }

  updateSaveButton(saveButton) {
    const isValid = this.standardSimulation || (this.selectedTb && this.selectedGtkw);
    saveButton.disabled = !isValid;
  }

  closeModal() {
    document.body.removeChild(this.modal);
  }
}