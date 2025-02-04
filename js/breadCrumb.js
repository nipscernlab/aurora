import React from 'react';

const Breadcrumb = () => {
  const [filePath, setFilePath] = React.useState('');

  React.useEffect(() => {
    // Listen for active tab changes
    const updateBreadcrumb = () => {
      const activePath = window.activeTab;
      if (activePath) {
        setFilePath(activePath);
      } else {
        setFilePath('');
      }
    };

    // Initial update
    updateBreadcrumb();

    // Setup observer for tab changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || 
           (mutation.type === 'attributes' && mutation.attributeName === 'class')) {
          updateBreadcrumb();
        }
      });
    });

    const tabsContainer = document.getElementById('tabs-container');
    if (tabsContainer) {
      observer.observe(tabsContainer, {
        childList: true,
        subtree: true,
        attributes: true
      });
    }

    return () => observer.disconnect();
  }, []);

  if (!filePath) return null;

  const parts = filePath.split('\\');
  const fileName = parts[parts.length - 1];
  const pathParts = parts.slice(0, -1);

  return (
    <div className="breadcrumb-container">
      {pathParts.map((part, index) => (
        <React.Fragment key={index}>
          <span className="breadcrumb-folder">
            <i className="fas fa-folder text-yellow-500 mr-1" />
            {part}
          </span>
          <span className="breadcrumb-separator">/</span>
        </React.Fragment>
      ))}
      <span className="breadcrumb-file">
        <i className={`${getFileIcon(fileName)} mr-1`} />
        {fileName}
      </span>
    </div>
  );
};

const getFileIcon = (filename) => {
  const extension = filename.split('.').pop().toLowerCase();
  const iconMap = {
    'js': 'fab fa-js text-yellow-400',
    'jsx': 'fab fa-react text-blue-400',
    'ts': 'fab fa-js text-blue-500',
    'tsx': 'fab fa-react text-blue-400',
    'html': 'fab fa-html5 text-orange-500',
    'css': 'fab fa-css3 text-blue-500',
    'json': 'fas fa-code text-yellow-300',
    'md': 'fab fa-markdown text-white',
    'py': 'fab fa-python text-green-400',
    'c': 'fas fa-code text-blue-300',
    'cpp': 'fas fa-code text-pink-400',
    'h': 'fas fa-code text-purple-400',
    'hpp': 'fas fa-code text-purple-400'
  };
  return iconMap[extension] || 'fas fa-file text-gray-400';
};

export default Breadcrumb;