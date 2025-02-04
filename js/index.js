import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { FormsporeProvider } from '@formspree/react';
import BugReportForm from './report';

function App() {
  const [showBugModal, setShowBugModal] = useState(false);

  return (
    <FormsporeProvider project="seu_projeto_formspree_id">
      <div>
        {showBugModal && (
          <div className="modal-overlay" onClick={() => setShowBugModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <BugReportForm onClose={() => setShowBugModal(false)} />
            </div>
          </div>
        )}
      </div>
    </FormsporeProvider>
  );
}

// Configurar evento do botão
document.getElementById('bugReportButton').addEventListener('click', () => {
  ReactDOM.render(<App />, document.getElementById('root'));
});