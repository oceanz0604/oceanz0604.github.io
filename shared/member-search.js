/**
 * OceanZ Gaming Cafe - Member Search & Autocomplete
 * 
 * Provides autocomplete functionality for member name input fields.
 * Can be used with both regular members and guest terminals.
 * 
 * Usage:
 *   import { MemberSearch } from '../shared/member-search.js';
 *   
 *   const search = new MemberSearch({
 *     inputElement: document.getElementById('memberInput'),
 *     suggestionsElement: document.getElementById('suggestions'),
 *     onSelect: (member) => console.log('Selected:', member),
 *     includeGuests: true
 *   });
 *   
 *   // Load members from Firebase
 *   search.loadMembers(firebaseRef);
 */

import { CONSTANTS, getShortTerminalName } from "./config.js";

// ==================== MEMBER SEARCH CLASS ====================

export class MemberSearch {
  /**
   * @param {Object} options
   * @param {HTMLInputElement} options.inputElement - Input field for member name
   * @param {HTMLElement} options.suggestionsElement - Container for suggestions dropdown
   * @param {Function} options.onSelect - Callback when member is selected
   * @param {boolean} options.includeGuests - Include guest terminals in search
   * @param {number} options.maxSuggestions - Maximum suggestions to show (default: 6)
   * @param {HTMLSelectElement} options.guestDropdown - Optional dropdown for guest terminals
   */
  constructor(options) {
    this.input = options.inputElement;
    this.suggestions = options.suggestionsElement;
    this.onSelect = options.onSelect || (() => {});
    this.includeGuests = options.includeGuests ?? true;
    this.maxSuggestions = options.maxSuggestions || 6;
    this.guestDropdown = options.guestDropdown;
    
    this.members = [];
    this.selectedMember = "";
    
    this.init();
  }
  
  init() {
    if (!this.input || !this.suggestions) {
      console.warn("MemberSearch: Missing required elements");
      return;
    }
    
    // Input event - show suggestions
    this.input.addEventListener("input", () => this.handleInput());
    
    // Blur event - finalize selection
    this.input.addEventListener("blur", () => {
      setTimeout(() => {
        this.hideSuggestions();
        this.selectedMember = this.input.value.trim().toUpperCase();
        this.onSelect(this.selectedMember);
      }, 200);
    });
    
    // Keyboard navigation
    this.input.addEventListener("keydown", (e) => this.handleKeydown(e));
    
    // Guest dropdown if provided
    if (this.guestDropdown) {
      this.populateGuestDropdown();
      this.guestDropdown.addEventListener("change", (e) => {
        if (e.target.value) {
          this.selectMember(e.target.value);
          e.target.selectedIndex = 0;
        }
      });
    }
  }
  
  /**
   * Load members from Firebase
   * @param {Object} firebaseRef - Firebase database reference to members
   */
  async loadMembers(firebaseRef) {
    try {
      const snap = await firebaseRef.once("value");
      const data = snap.val() || [];
      this.members = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
      console.log(`✅ Loaded ${this.members.length} members for search`);
    } catch (error) {
      console.error("Failed to load members:", error);
      this.members = [];
    }
  }
  
  /**
   * Set members directly (without Firebase)
   * @param {Array} members - Array of member objects with USERNAME field
   */
  setMembers(members) {
    this.members = members || [];
  }
  
  handleInput() {
    const query = this.input.value.toLowerCase().trim();
    this.suggestions.innerHTML = "";
    
    if (!query) {
      this.hideSuggestions();
      return;
    }
    
    // Search members
    let matches = this.members
      .filter(m => m.USERNAME?.toLowerCase().includes(query))
      .slice(0, this.maxSuggestions);
    
    // Add matching guest terminals if enabled
    if (this.includeGuests) {
      const guestMatches = CONSTANTS.TIMETABLE_PCS
        .filter(t => {
          const short = getShortTerminalName(t);
          return short.toLowerCase().includes(query) || t.toLowerCase().includes(query);
        })
        .map(t => ({ USERNAME: t.toUpperCase(), isGuest: true }));
      
      // Add guests that don't duplicate existing matches
      const existingNames = new Set(matches.map(m => m.USERNAME?.toUpperCase()));
      guestMatches.forEach(g => {
        if (!existingNames.has(g.USERNAME) && matches.length < this.maxSuggestions) {
          matches.push(g);
        }
      });
    }
    
    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }
    
    // Render suggestions
    matches.forEach((m, index) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.dataset.index = index;
      
      const displayName = m.isGuest 
        ? `🖥️ ${getShortTerminalName(m.USERNAME)}` 
        : m.USERNAME;
      
      div.innerHTML = `
        <span class="suggestion-name">${displayName}</span>
        ${m.isGuest ? '<span class="suggestion-badge guest">Guest</span>' : ''}
      `;
      
      div.addEventListener("click", () => this.selectMember(m.USERNAME));
      div.addEventListener("mouseenter", () => this.highlightSuggestion(index));
      
      this.suggestions.appendChild(div);
    });
    
    this.showSuggestions();
  }
  
  handleKeydown(e) {
    const items = this.suggestions.querySelectorAll(".suggestion");
    if (items.length === 0) return;
    
    const current = this.suggestions.querySelector(".suggestion.highlighted");
    let currentIndex = current ? parseInt(current.dataset.index) : -1;
    
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.highlightSuggestion(Math.min(currentIndex + 1, items.length - 1));
        break;
        
      case "ArrowUp":
        e.preventDefault();
        this.highlightSuggestion(Math.max(currentIndex - 1, 0));
        break;
        
      case "Enter":
        if (current) {
          e.preventDefault();
          const username = this.members[currentIndex]?.USERNAME || 
                          CONSTANTS.TIMETABLE_PCS[currentIndex - this.members.length]?.toUpperCase();
          if (username) this.selectMember(username);
        }
        break;
        
      case "Escape":
        this.hideSuggestions();
        break;
    }
  }
  
  highlightSuggestion(index) {
    const items = this.suggestions.querySelectorAll(".suggestion");
    items.forEach((item, i) => {
      item.classList.toggle("highlighted", i === index);
    });
  }
  
  selectMember(username) {
    this.selectedMember = username.toUpperCase();
    this.input.value = this.selectedMember;
    this.hideSuggestions();
    this.onSelect(this.selectedMember);
  }
  
  showSuggestions() {
    this.suggestions.classList.add("show");
  }
  
  hideSuggestions() {
    this.suggestions.classList.remove("show");
  }
  
  populateGuestDropdown() {
    if (!this.guestDropdown) return;
    
    // Clear existing options except first
    while (this.guestDropdown.options.length > 1) {
      this.guestDropdown.remove(1);
    }
    
    // Add guest terminals
    CONSTANTS.TIMETABLE_PCS.forEach(terminal => {
      const opt = document.createElement("option");
      opt.value = terminal.toUpperCase();
      opt.textContent = getShortTerminalName(terminal);
      this.guestDropdown.appendChild(opt);
    });
  }
  
  /**
   * Get currently selected member
   * @returns {string} Selected member username
   */
  getSelected() {
    return this.selectedMember;
  }
  
  /**
   * Clear selection and input
   */
  clear() {
    this.selectedMember = "";
    this.input.value = "";
    this.hideSuggestions();
  }
}

// ==================== SIMPLE AUTOCOMPLETE FUNCTION ====================

/**
 * Simple autocomplete setup for member inputs
 * @param {HTMLInputElement} input - Input element
 * @param {HTMLElement} suggestionsContainer - Suggestions container
 * @param {Array} members - Array of member objects
 * @param {Function} onSelect - Selection callback
 */
export function setupMemberAutocomplete(input, suggestionsContainer, members, onSelect) {
  const search = new MemberSearch({
    inputElement: input,
    suggestionsElement: suggestionsContainer,
    onSelect: onSelect,
    includeGuests: true
  });
  search.setMembers(members);
  return search;
}

// ==================== STYLES ====================

// Inject styles if not already present
if (!document.getElementById("member-search-styles")) {
  const style = document.createElement("style");
  style.id = "member-search-styles";
  style.textContent = `
    .member-suggestions,
    .suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: rgba(10, 10, 15, 0.98);
      border: 2px solid var(--neon-orange, #ff6b00);
      border-top: none;
      border-radius: 0 0 8px 8px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    }
    
    .member-suggestions.show,
    .suggestions.show {
      display: block;
    }
    
    .suggestion {
      padding: 10px 12px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.15s;
    }
    
    .suggestion:hover,
    .suggestion.highlighted {
      background: rgba(255, 107, 0, 0.2);
    }
    
    .suggestion-name {
      font-family: 'Orbitron', monospace;
      color: var(--neon-orange, #ff6b00);
      font-weight: 600;
    }
    
    .suggestion-badge {
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    
    .suggestion-badge.guest {
      background: rgba(0, 240, 255, 0.2);
      color: #00f0ff;
    }
  `;
  document.head.appendChild(style);
}

