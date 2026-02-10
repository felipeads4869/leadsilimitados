import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { businessCategories } from './categories';
import { Search, Download, MapPin, Star, Phone, Globe, Loader2, AlertCircle, Building2 } from 'lucide-react';

interface PlaceData {
    name: string;
    address: string;
    website?: string;
    phone?: string;
    rating?: number;
    reviews?: number;
    place_id?: string;
}

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

function App() {
    const [apiKey, setApiKey] = useState('');
    const [location, setLocation] = useState('');
    const [category, setCategory] = useState('');

    const [results, setResults] = useState<PlaceData[]>([]);
    const [status, setStatus] = useState<SearchStatus>('idle');
    const [errorMessage, setErrorMessage] = useState('');


    // Autocomplete state
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredCategories, setFilteredCategories] = useState<string[]>([]);

    const scriptLoadedRef = useRef(false);

    useEffect(() => {
        if (category) {
            const filtered = businessCategories.filter(c =>
                c.toLowerCase().includes(category.toLowerCase())
            ).slice(0, 10);
            setFilteredCategories(filtered);
        } else {
            setFilteredCategories([]);
        }
    }, [category]);

    const loadGoogleMaps = () => {
        if (scriptLoadedRef.current) return;
        if (!apiKey) {
            setErrorMessage("Please enter a valid Google Maps API Key");
            return;
        }

        const script = document.createElement('script');
        // Using weekly channel where `importLibrary` is definitely available
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            scriptLoadedRef.current = true;
            setErrorMessage("");
        };
        script.onerror = () => {
            setErrorMessage("Failed to load Google Maps API. Check your API Key.");
        };
        document.head.appendChild(script);
    };

    const handleSearch = async () => {
        if (!apiKey) {
            setErrorMessage("Please enter an API Key first.");
            return;
        }

        if (!scriptLoadedRef.current) {
            loadGoogleMaps();
            setTimeout(handleSearch, 1000);
            return;
        }

        if (!location || !category) {
            setErrorMessage("Please fill in both Location and Business Category.");
            return;
        }

        setStatus('loading');
        setResults([]);

        setErrorMessage('');

        try {
            // Use the modern "New" Places API (Text Search New) via importLibrary
            // @ts-ignore Google Maps types might lag slightly behind dynamically imported libraries
            const { Place } = await google.maps.importLibrary("places") as { Place: any };

            const query = `${category} in ${location}`;

            // Request specific fields to optimize cost (Field Masking)
            // New API uses camelCase field names 
            const { places } = await Place.searchByText({
                textQuery: query,
                fields: ['displayName', 'formattedAddress', 'websiteURI', 'nationalPhoneNumber', 'rating', 'userRatingCount', 'location'],
                isOpenNow: false, // Optional: filter for currently open places
            });

            const mappedResults: PlaceData[] = [];

            if (places && places.length > 0) {
                for (let i = 0; i < places.length; i++) {
                    const p = places[i];
                    mappedResults.push({
                        name: p.displayName, // New API returns name as property often, or displayName
                        address: p.formattedAddress,
                        website: p.websiteURI,
                        phone: p.nationalPhoneNumber,
                        rating: p.rating,
                        reviews: p.userRatingCount,
                        place_id: p.id
                    });


                }
            }

            setResults(mappedResults);
            setStatus('success');

        } catch (e: any) {
            console.error(e);
            setStatus('error');
            setErrorMessage(`Search failed: ${e.message || e}`);
        }
    };

    const handleExport = () => {
        const ws = XLSX.utils.json_to_sheet(results.map(r => ({
            "Business Name": r.name,
            "Address": r.address,
            "Phone": r.phone || "N/A",
            "Website": r.website || "N/A",
            "Rating": r.rating || "N/A",
            "Reviews": r.reviews || 0
        })));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Businesses");
        const filename = `${category.replace(/\s+/g, '_')}_${location.replace(/\s+/g, '_')}_leads.xlsx`;
        XLSX.writeFile(wb, filename);
    };

    return (
        <div className="app-container">

            <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
                <h1>Growth Extractor AI</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Identify, Analyze, and Export Business Leads with Precision (Places API New)</p>
            </header>

            <div className="card search-panel">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>

                    <div className="input-group">
                        <label className="label">Google Maps API Key</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="password"
                                placeholder="Paste your API Key here (AIza...)"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                style={{ paddingLeft: '2.5rem' }}
                            />
                            <div style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}>
                                <StartIcon size={18} />
                            </div>
                        </div>
                        <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.5rem', display: 'block' }}>
                            Your key is processed locally. Required: <strong>Places API (New)</strong> & Maps JavaScript API enabled.
                        </small>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                        <div className="input-group">
                            <label className="label">Location</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    placeholder="e.g. New York, NY"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    style={{ paddingLeft: '2.5rem' }}
                                />
                                <MapPin style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} size={18} />
                            </div>
                        </div>

                        <div className="input-group">
                            <label className="label">Business Category</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    placeholder="Type to search (e.g. Restaurante)"
                                    value={category}
                                    onChange={(e) => {
                                        setCategory(e.target.value);
                                        setShowSuggestions(true);
                                    }}
                                    onFocus={() => setShowSuggestions(true)}
                                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                    style={{ paddingLeft: '2.5rem' }}
                                />
                                <Building2 style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} size={18} />

                                {showSuggestions && filteredCategories.length > 0 && (
                                    <div className="autocomplete-list">
                                        {filteredCategories.map((cat, i) => (
                                            <div
                                                key={i}
                                                className="autocomplete-item"
                                                onClick={() => {
                                                    setCategory(cat);
                                                    setShowSuggestions(false);
                                                }}
                                            >
                                                {cat}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        className="primary"
                        onClick={handleSearch}
                        disabled={status === 'loading'}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1.1rem', padding: '1rem' }}
                    >
                        {status === 'loading' ? (
                            <>
                                <Loader2 className="loader" size={20} />
                                Searching...
                            </>
                        ) : (
                            <>
                                <Search size={20} /> Find Businesses
                            </>
                        )}
                    </button>

                    {errorMessage && (
                        <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#f87171', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <AlertCircle size={20} />
                            {errorMessage}
                        </div>
                    )}
                </div>
            </div>

            {results.length > 0 && (
                <div className="card results-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h2 style={{ margin: 0 }}>Found {results.length} Businesses</h2>
                        <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#10b981', color: 'white' }}>
                            <Download size={18} /> Export to Excel
                        </button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Address</th>
                                    <th>Rating</th>
                                    <th>Contact</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((place, idx) => (
                                    <tr key={idx}>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{place.name}</div>
                                            {place.website && (
                                                <a href={place.website} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                                                    <Globe size={12} /> Website
                                                </a>
                                            )}
                                        </td>
                                        <td style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{place.address}</td>
                                        <td>
                                            {place.rating ? (
                                                <div className="badge">
                                                    <Star size={12} style={{ marginRight: '4px', fill: 'currentColor' }} />
                                                    {place.rating} ({place.reviews})
                                                </div>
                                            ) : <span style={{ color: 'var(--text-secondary)' }}>-</span>}
                                        </td>
                                        <td>
                                            {place.phone ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    <Phone size={14} /> {place.phone}
                                                </div>
                                            ) : <span style={{ color: 'var(--text-secondary)' }}>-</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// Icon wrapper for the key input
const StartIcon = ({ size }: { size: number }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M12.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.5" />
        <path d="M16 3v4" />
        <path d="M21 3v4" />
        <path d="M21 7h-5" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 15v8" />
    </svg>
);

export default App;
