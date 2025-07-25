// Aurora IDE Dynamic Greeting and Quote System
// This script provides time-based greetings and philosopher quotes

class AuroraWelcomeSystem {
  constructor() {
    this.philosopherQuotes = [
    {
        text: "The only true wisdom is in knowing you know nothing.",
        author: "Socrates"
    },
    {
        text: "It is during our darkest moments that we must focus to see the light.",
        author: "Aristotle"
    },
    {
        text: "The unexamined life is not worth living.",
        author: "Plato"
    },
    {
        text: "Mathematics, rightly viewed, possesses not only truth but supreme beauty.",
        author: "Bertrand Russell"
    },
    {
        text: "I don’t know why we are here, but I’m pretty sure that it is not in order to enjoy ourselves.",
        author: "Ludwig Wittgenstein"
    },
    {
        text: "To understand is to perceive patterns.",
        author: "Isaiah Berlin"
    },
    {
        text: "The more I see, the less I know for sure.",
        author: "Richard Feynman"
    },
    {
        text: "What we cannot speak about we must pass over in silence.",
        author: "Ludwig Wittgenstein"
    },
    {
        text: "Logic is the anatomy of thought.",
        author: "John Locke"
    },
    {
        text: "The essence of mathematics lies in its freedom.",
        author: "Georg Cantor"
    },
    {
        text: "Mathematics is the queen of the sciences.",
        author: "Carl Friedrich Gauss"
    },
    {
        text: "The laws of nature are but the mathematical thoughts of God.",
        author: "Euclid"
    },
    {
        text: "In questions of science, the authority of a thousand is not worth the humble reasoning of a single individual.",
        author: "Galileo Galilei"
    },
    {
        text: "Science is the belief in the ignorance of experts.",
        author: "Richard Feynman"
    },
    {
        text: "We must know — we will know!",
        author: "David Hilbert"
    },
    {
        text: "Truth is what stands the test of experience.",
        author: "Albert Einstein"
    },
    {
        text: "Imagination is more important than knowledge.",
        author: "Albert Einstein"
    },
    {
        text: "If you can't explain it simply, you don't understand it well enough.",
        author: "Albert Einstein"
    },
    {
        text: "God does not play dice with the universe.",
        author: "Albert Einstein"
    },
    {
        text: "Physics is not about how the world is, it is about what we can say about the world.",
        author: "Niels Bohr"
    },
    {
        text: "Not only is the Universe stranger than we think, it is stranger than we can think.",
        author: "Werner Heisenberg"
    },
    {
        text: "The scientist is not a person who gives the right answers, he’s one who asks the right questions.",
        author: "Claude Lévi-Strauss"
    },
    {
        text: "Science is a way of trying not to fool yourself.",
        author: "Richard Feynman"
    },
    {
        text: "No amount of experimentation can ever prove me right; a single experiment can prove me wrong.",
        author: "Albert Einstein"
    },
    {
        text: "Science without religion is lame, religion without science is blind.",
        author: "Albert Einstein"
    },
    {
        text: "The universe is under no obligation to make sense to you.",
        author: "Neil deGrasse Tyson"
    },
    {
        text: "If I have seen further it is by standing on the shoulders of giants.",
        author: "Isaac Newton"
    },
    {
        text: "Nature uses only the longest threads to weave her patterns, so each small piece of her fabric reveals the organization of the entire tapestry.",
        author: "Richard Feynman"
    },
    {
        text: "Pure mathematics is, in its way, the poetry of logical ideas.",
        author: "Albert Einstein"
    },
    {
        text: "It is wrong to think that the task of physics is to find out how nature is. Physics concerns what we can say about nature.",
        author: "Niels Bohr"
    },
    {
        text: "Chemistry is necessarily an experimental science: its conclusions are drawn from data, and its principles supported by evidence from facts.",
        author: "Michael Faraday"
    },
    {
        text: "In science there are no shortcuts to truth.",
        author: "Karl Popper"
    },
    {
        text: "Science is organized knowledge. Wisdom is organized life.",
        author: "Immanuel Kant"
    },
    {
        text: "The most incomprehensible thing about the universe is that it is comprehensible.",
        author: "Albert Einstein"
    },
    {
        text: "A mathematician is a blind man in a dark room looking for a black cat which isn’t there.",
        author: "Charles Darwin"
    },
    {
        text: "A physicist is just an atom’s way of looking at itself.",
        author: "Niels Bohr"
    },
    {
        text: "The highest activity a human being can attain is learning for understanding, because to understand is to be free.",
        author: "Baruch Spinoza"
    },
    {
        text: "There is nothing new to be discovered in physics now. All that remains is more and more precise measurement.",
        author: "Lord Kelvin"
    },
    {
        text: "In science, there are only solutions — no problems.",
        author: "Marcel Proust"
    },
    {
        text: "The great tragedy of science — the slaying of a beautiful hypothesis by an ugly fact.",
        author: "Thomas Huxley"
    },
    {
        text: "Philosophy is written in that great book which ever lies before our eyes — I mean the universe — but we cannot understand it if we do not first learn the language and grasp the symbols in which it is written.",
        author: "Galileo Galilei"
    }
    ];
    
    this.init();
  }

  init() {
    this.injectStyles();
    this.updateGreeting();
    this.displayQuoteOfTheDay();
    
    // Update greeting every minute
    setInterval(() => this.updateGreeting(), 60000);
    
    // Update quote every hour (optional - you can remove this line if you want quotes to stay the same)
    setInterval(() => this.displayQuoteOfTheDay(), 3600000);
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .quote-section {
        margin-top: var(--space-8);
        padding: var(--space-6);
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        transition: all var(--transition-normal);
      }

      .quote-section:hover {
        box-shadow: var(--shadow-md);
        border-color: var(--border-accent);
      }

      .quote-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
      }

      .quote-icon {
        color: var(--icon-primary);
        font-size: var(--text-lg);
      }

      .quote-title {
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        margin: 0;
      }

      .quote-content {
        margin-bottom: var(--space-4);
      }

      .quote-text {
        font-family: var(--font-sans);
        font-size: var(--text-base);
        font-style: italic;
        color: var(--text-secondary);
        line-height: var(--leading-relaxed);
        margin: 0 0 var(--space-3) 0;
        position: relative;
        padding-left: var(--space-6);
      }

      .quote-text::before {
        content: '"';
        position: absolute;
        left: 0;
        top: -5px;
        font-size: var(--text-2xl);
        color: var(--accent-primary);
        font-weight: var(--font-bold);
        line-height: 1;
      }

      .quote-author {
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-muted);
        text-align: right;
        margin: 0;
        position: relative;
      }

      .quote-author::before {
        content: '— ';
        color: var(--accent-primary);
      }

      .greeting-text {
        background: var(--gradient-primary);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: fadeIn var(--transition-slow) ease-out;
      }

      @keyframes fadeIn {
        from { 
          opacity: 0; 
          transform: translateY(10px); 
        }
        to { 
          opacity: 1; 
          transform: translateY(0); 
        }
      }

      .quote-section {
        animation: fadeIn var(--transition-slow) ease-out;
        animation-delay: 0.2s;
        animation-fill-mode: both;
      }
    `;
    document.head.appendChild(style);
  }

  getTimeBasedGreeting() {
    const now = new Date();
    const hour = now.getHours();
    
    if (hour >= 5 && hour < 12) {
      return "Good Morning!";
    } else if (hour >= 12 && hour < 18) {
      return "Good Afternoon!";
    } else {
      return "Good Evening!";
    }
  }

  updateGreeting() {
    const titleElement = document.getElementById('aurora-welcome');
    if (titleElement) {
      const greeting = this.getTimeBasedGreeting();
      const welcomeText = `${greeting} Welcome to AURORA IDE!`;
      
      // Add animation class for smooth transition
      titleElement.classList.remove('greeting-text');
      titleElement.offsetHeight; // Force reflow
      titleElement.classList.add('greeting-text');
      titleElement.textContent = welcomeText;
    }
  }

  getRandomQuote() {
    const randomIndex = Math.floor(Math.random() * this.philosopherQuotes.length);
    return this.philosopherQuotes[randomIndex];
  }

  displayQuoteOfTheDay() {
    // Check if quote section already exists
    let quoteSection = document.getElementById('quote-of-the-day');
    
    if (!quoteSection) {
      // Create quote section
      quoteSection = document.createElement('div');
      quoteSection.id = 'quote-of-the-day';
      quoteSection.className = 'quote-section';
      
      // Find the recent projects section and insert after it
      const recentProjectsSection = document.querySelector('.recent-projects-section');
      if (recentProjectsSection && recentProjectsSection.parentNode) {
        recentProjectsSection.parentNode.insertBefore(quoteSection, recentProjectsSection.nextSibling);
      }
    }

    const quote = this.getRandomQuote();
    
    quoteSection.innerHTML = `
      <div class="quote-header">
        <i class="fa-solid fa-quote-right quote-icon"></i>
        <h3 class="quote-title">Quote of the Day</h3>
      </div>
      <div class="quote-content">
        <p class="quote-text">${quote.text}</p>
        <p class="quote-author">${quote.author}</p>
      </div>
    `;
  }

  // Method to add new quotes (for manual addition)
  addQuote(text, author) {
    this.philosopherQuotes.push({ text, author });
  }

  // Method to get all quotes (for management)
  getAllQuotes() {
    return this.philosopherQuotes;
  }

  // Method to remove a quote by index
  removeQuote(index) {
    if (index >= 0 && index < this.philosopherQuotes.length) {
      this.philosopherQuotes.splice(index, 1);
    }
  }
}

// Initialize the system when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.auroraWelcome = new AuroraWelcomeSystem();
});

// Also initialize if DOM is already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.auroraWelcome = new AuroraWelcomeSystem();
  });
} else {
  window.auroraWelcome = new AuroraWelcomeSystem();
}

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuroraWelcomeSystem;
}