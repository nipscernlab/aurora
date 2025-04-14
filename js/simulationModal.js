class SimulationModal {
  constructor() {
    this.modal = null;
    this.tbFiles = []; // List of testbench files
    this.gtkwFiles = []; // List of GTKWave files
    this.selectedTb = ''; // Selected testbench file
    this.selectedGtkw = ''; // Selected GTKWave file
    this.standardSimulation = false; // Flag for standard simulation mode
  }

  // Display the modal and load the testbench and GTKWave files
  async show(hardwarePath) {
    const files = await window.electronAPI.readDir(hardwarePath);
    this.tbFiles = files.filter(file => file.endsWith('_tb.v'));
    this.gtkwFiles = files.filter(file => file.endsWith('.gtkw'));

    return new Promise((resolve) => {
      this.createModal(resolve);
    });
  }

  // Create the modal structure and inject it into the DOM
  createModal(resolve) {
    const modalHtml = `
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
          <label class="standard-simulation">
            <input type="checkbox" name="standard" ${this.selectedTb || this.selectedGtkw ? 'disabled' : ''}>
            <i class="fas fa-cogs"></i>
            <span>Standard Simulation</span>
          </label>
        </div>

        <div class="modal-footer">
          <button class="btn btn-cancel">Cancel</button>
          <button class="btn btn-save" disabled>Save</button>
        </div>
      </div>
    `;

    this.modal = document.createElement('div');
    this.modal.innerHTML = modalHtml;
    document.body.appendChild(this.modal);

    this.setupEventListeners(resolve);
  }

  // Set up event listeners for modal interactions
  setupEventListeners(resolve) {
    const tbCheckboxes = this.modal.querySelectorAll('input[name="tb"]');
    const gtkwCheckboxes = this.modal.querySelectorAll('input[name="gtkw"]');
    const standardCheckbox = this.modal.querySelector('input[name="standard"]');
    const saveButton = this.modal.querySelector('.btn-save');
    const cancelButton = this.modal.querySelector('.btn-cancel');

    // Handle testbench file selection
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

    // Handle GTKWave file selection
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

    // Handle standard simulation mode toggle
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

    // Handle save button click
    saveButton.addEventListener('click', () => {
      const result = {
        standardSimulation: this.standardSimulation,
        selectedTb: this.selectedTb,
        selectedGtkw: this.selectedGtkw
      };
      this.closeModal();
      resolve(result);
    });

    // Handle cancel button click
    cancelButton.addEventListener('click', () => {
      this.closeModal();
      resolve(null);
    });
  }

  // Enable or disable the save button based on the current selection
  updateSaveButton(saveButton) {
    const isValid = this.standardSimulation || (this.selectedTb && this.selectedGtkw);
    saveButton.disabled = !isValid;
  }

  // Close the modal and remove it from the DOM
  closeModal() {
    document.body.removeChild(this.modal);
  }
}