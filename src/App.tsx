import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { businessCategories } from './categories';
import { Search, Download, MapPin, Star, Globe, Loader2, AlertCircle, Building2, MessageCircle, PhoneCall, Filter, ChevronUp, ChevronDown, Facebook, Video } from 'lucide-react';

interface PlaceData {
    name: string;
    address: string;
    website?: string;
    phone?: string;
    rating?: number;
    reviews?: number;
    place_id?: string;
    google_maps_link?: string;
    // CRM Fields
    status: 'Pendiente' | 'Contactado' | 'Seguimiento' | 'Agendado' | 'Muerto';
    notes: string;
}

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

function App() {
    const [apiKey, setApiKey] = useState('');
    const [location, setLocation] = useState('');
    const [category, setCategory] = useState('');

    const [results, setResults] = useState<PlaceData[]>([]);
    const [status, setStatus] = useState<SearchStatus>('idle');
    const [errorMessage, setErrorMessage] = useState('');

    // CRM Filter State
    const [filterText, setFilterText] = useState('');

    // Autocomplete state
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredCategories, setFilteredCategories] = useState<string[]>([]);

    const scriptLoadedRef = useRef(false);

    // Load from LocalStorage on mount
    useEffect(() => {
        const savedResults = localStorage.getItem('crm_results');

        if (savedResults) {
            try {
                setResults(JSON.parse(savedResults));
            } catch (e) {
                console.error("Failed to load saved results", e);
            }
        }
    }, []);

    // Save to LocalStorage whenever results change
    useEffect(() => {
        if (results.length > 0) {
            localStorage.setItem('crm_results', JSON.stringify(results));
        }
    }, [results]);

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

    // Filter States
    const [minReviews, setMinReviews] = useState<number>(0);
    const [maxReviews, setMaxReviews] = useState<number>(10000);
    const [onlyNoWebsite, setOnlyNoWebsite] = useState(false);
    const [onlyOperational, setOnlyOperational] = useState(true);
    const [targetLeads, setTargetLeads] = useState<number>(20);
    const [showSettings, setShowSettings] = useState(false);

    // ... (rest of useEffects)

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
            const needsComplexFetch = targetLeads > 20 || minReviews > 0 || maxReviews < 10000 || onlyNoWebsite || !onlyOperational;
            const query = `${category} in ${location}`;

            let finalResults: PlaceData[] = [];

            if (!needsComplexFetch) {
                // Fast Path (Optimized)
                // @ts-ignore
                const { Place } = await google.maps.importLibrary("places") as { Place: any };
                const { places } = await Place.searchByText({
                    textQuery: query,
                    fields: ['displayName', 'formattedAddress', 'websiteURI', 'nationalPhoneNumber', 'rating', 'userRatingCount', 'location', 'id', 'googleMapsURI'],
                    isOpenNow: false,
                });

                finalResults = (places || []).map((p: any) => ({
                    name: p.displayName,
                    address: p.formattedAddress,
                    website: p.websiteURI,
                    phone: p.nationalPhoneNumber,
                    rating: p.rating,
                    reviews: p.userRatingCount,
                    place_id: p.id,
                    google_maps_link: p.googleMapsURI,
                    status: 'Pendiente',
                    notes: ''
                }));

            } else {
                // Advanced Path (Targeted Extraction)
                const service = new google.maps.places.PlacesService(document.createElement('div'));

                // 1. Fetch Candidates (Legacy Loop) - Gets up to 60 basic items
                const getAllCandidates = () => {
                    return new Promise<google.maps.places.PlaceResult[]>((resolve) => {
                        let collected: google.maps.places.PlaceResult[] = [];

                        service.textSearch({ query }, (results, status, pagination) => {
                            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                                // Pre-Filter Candidates to save on Details Calls
                                const validCandidates = results.filter(p => {
                                    const reviewCount = p.user_ratings_total || 0;
                                    const isOperational = p.business_status === 'OPERATIONAL';

                                    if (onlyOperational && !isOperational) return false;
                                    if (reviewCount < minReviews) return false;
                                    if (reviewCount > maxReviews) return false;
                                    return true;
                                });

                                collected = [...collected, ...validCandidates];

                                // Check if we have enough OR if we need more pages
                                if (collected.length < targetLeads && pagination && pagination.hasNextPage) {
                                    setTimeout(() => pagination.nextPage(), 2000);
                                } else {
                                    resolve(collected.slice(0, targetLeads));
                                }
                            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                                resolve(collected);
                            } else {
                                resolve(collected); // Return what we have on error to avoid blocking
                            }
                        });
                    });
                };

                const candidates = await getAllCandidates();

                // 2. Fetch Rich Details for Survivors (New API Wrapper)
                // @ts-ignore
                const { Place } = await google.maps.importLibrary("places") as { Place: any };

                const detailedPromises = candidates.map(async (c) => {
                    if (!c.place_id) return null;
                    const place = new Place({ id: c.place_id });
                    // Fetch specifically what we need
                    try {
                        await place.fetchFields({
                            fields: ['displayName', 'formattedAddress', 'websiteURI', 'nationalPhoneNumber', 'googleMapsURI']
                        });

                        // Post-Fetch Filter: No Website
                        if (onlyNoWebsite && place.websiteURI) return null; // Skip if it has a website

                        return {
                            name: place.displayName || c.name || 'N/A',
                            address: place.formattedAddress || c.formatted_address || 'N/A',
                            website: place.websiteURI,
                            phone: place.nationalPhoneNumber, // Rich data!
                            rating: c.rating, // Keep legacy rating if new one not fetched (saves field cost?) - actually new one is better but let's use what we have
                            reviews: c.user_ratings_total,
                            place_id: c.place_id,
                            google_maps_link: place.googleMapsURI,
                            status: 'Pendiente',
                            notes: ''
                        } as PlaceData;
                    } catch (err) {
                        console.warn('Failed to fetch details for', c.place_id, err);
                        return null;
                    }
                });

                const detailedResults = await Promise.all(detailedPromises);
                finalResults = detailedResults.filter(r => r !== null) as PlaceData[];
            }

            // 3. Sort by Reviews
            finalResults.sort((a, b) => (b.reviews || 0) - (a.reviews || 0));

            setResults(finalResults);
            setStatus('success');

        } catch (e: any) {
            console.error(e);
            setStatus('error');
            setErrorMessage(`Search failed: ${e.message || e}`);
        }
    };

    const handleUpdateStatus = (idx: number, newStatus: PlaceData['status']) => {
        const newResults = [...results];
        newResults[idx].status = newStatus;
        setResults(newResults);
    };

    const handleUpdateNotes = (idx: number, newNotes: string) => {
        const newResults = [...results];
        newResults[idx].notes = newNotes;
        setResults(newResults);
    };

    const filteredResults = results.filter(r =>
        r.name.toLowerCase().includes(filterText.toLowerCase()) ||
        r.status.toLowerCase().includes(filterText.toLowerCase())
    );

    const handleExport = () => {
        // Create headers
        const headers = ["Business Name", "Address", "Phone (WhatsApp)", "Website", "Google Maps Link", "Rating", "Reviews", "Status", "Notes"];

        // Map data
        const data = results.map(r => [
            r.name,
            r.address,
            r.phone || "N/A",
            r.website || "N/A",
            r.google_maps_link || "N/A",
            r.rating || "N/A",
            r.reviews || 0,
            r.status,
            r.notes
        ]);

        // Create worksheet from array of arrays
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

        // Apply formulas for phone numbers and maps to keep raw data visible but clickable
        results.forEach((r, i) => {
            if (r.phone) {
                // Determine cell ref (C is the 3rd column, index 2) -> C2, C3, etc.
                const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: 2 });
                // Clean phone for URL (remove spaces, dashes, etc)
                const cleanPhone = r.phone.replace(/[^\d+]/g, '');

                // Set the cell content to a hyperlink formula but DISPLAY the phone number
                ws[cellRef] = {
                    t: 's', // type string
                    v: r.phone, // Display value IS THE PHONE NUMBER
                    // Formula: HYPERLINK("https://wa.me/PHONE", "PHONE NUMBER")
                    f: `HYPERLINK("https://wa.me/${cleanPhone}", "${r.phone}")`,
                    l: { Target: `https://wa.me/${cleanPhone}`, Tooltip: "WhatsApp" }
                };
            }
            // Apply formula for Google Maps Link
            if (r.google_maps_link) {
                const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: 4 }); // E is the 5th column, index 4
                ws[cellRef] = {
                    t: 's',
                    v: r.google_maps_link, // Display value IS THE URL
                    f: `HYPERLINK("${r.google_maps_link}", "${r.google_maps_link}")`,
                    l: { Target: r.google_maps_link, Tooltip: "Google Maps" }
                };
            }
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "CRM Leads");
        const filename = `CRM_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, filename);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Contactado': return 'status-contactado';
            case 'Seguimiento': return 'status-seguimiento';
            case 'Agendado': return 'status-agendado';
            case 'Muerto': return 'status-muerto';
            default: return 'status-pendiente'; // Pendiente
        }
    };

    return (
        <div className="app-container">

            <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
                <h1>Google Maps Business Extractor</h1>
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
                            Your key is processed locally. Required: <strong>Places API (New)</strong>.
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

                    {/* Settings Toggle */}
                    <button
                        className="toggle-settings-btn"
                        onClick={() => setShowSettings(!showSettings)}
                        style={{ width: '100%', justifyContent: 'center', marginBottom: '10px' }}
                    >
                        {showSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {showSettings ? 'Hide Extraction Settings' : 'Advanced Extraction Settings'}
                    </button>

                    {showSettings && (
                        <div className="card settings-panel">
                            <div className="settings-grid">
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                        Min Reviews
                                    </label>
                                    <input
                                        type="number"
                                        className="input-field"
                                        value={minReviews}
                                        onChange={(e) => setMinReviews(Number(e.target.value))}
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                        Max Reviews
                                    </label>
                                    <input
                                        type="number"
                                        className="input-field"
                                        value={maxReviews}
                                        onChange={(e) => setMaxReviews(Number(e.target.value))}
                                        placeholder="10000"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                        Target Leads (Max)
                                    </label>
                                    <input
                                        type="number"
                                        className="input-field"
                                        value={targetLeads}
                                        onChange={(e) => setTargetLeads(Math.min(60, Number(e.target.value)))}
                                        placeholder="20"
                                        max={60}
                                    />
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        {targetLeads > 20 ? '⚠️ High token usage (Legacy Mode)' : '⚡ Optimized (New API)'}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', justifyContent: 'center' }}>
                                    <label className="checkbox-wrapper">
                                        <input
                                            type="checkbox"
                                            checked={onlyNoWebsite}
                                            onChange={(e) => setOnlyNoWebsite(e.target.checked)}
                                        />
                                        <span>Only No Website (High Value)</span>
                                    </label>
                                    <label className="checkbox-wrapper">
                                        <input
                                            type="checkbox"
                                            checked={onlyOperational}
                                            onChange={(e) => setOnlyOperational(e.target.checked)}
                                        />
                                        <span>Only Operational (Open)</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

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
                    <div className="flex-between mb-4">
                        <h2 style={{ margin: 0 }}>Active Leads: {filteredResults.length} / {results.length}</h2>

                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <div className="input-group" style={{ margin: 0, width: '300px' }}>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="text"
                                        placeholder="Filter by name or status..."
                                        value={filterText}
                                        onChange={(e) => setFilterText(e.target.value)}
                                        style={{ paddingLeft: '2.5rem', fontSize: '14px', padding: '10px 12px 10px 40px' }}
                                    />
                                    <Filter style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} size={16} />
                                </div>
                            </div>

                            <button onClick={handleExport} style={{ backgroundColor: '#34c759', color: 'white' }}>
                                <Download size={16} /> Export CRM
                            </button>
                        </div>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: '20%' }}>Business</th>
                                    <th style={{ width: '15%' }}>Contact</th>
                                    <th style={{ width: '15%' }}>Investigation</th>
                                    <th style={{ width: '15%' }}>Status</th>
                                    <th style={{ width: '20%' }}>Notes</th>
                                    <th style={{ width: '15%' }}>Rating (Reviews)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredResults.map((place, idx) => {
                                    // Use original index to update the main state correctly even when filtered
                                    const originalIndex = results.findIndex(r => r.place_id === place.place_id);
                                    const isDead = place.status === 'Muerto';

                                    return (
                                        <tr key={place.place_id || idx} className={isDead ? 'opacity-50' : ''}>
                                            <td>
                                                <div style={{ fontWeight: 600, fontSize: '15px' }}>{place.name}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{place.address}</div>
                                                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                                                    {place.website && (
                                                        <a href={place.website} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                            <Globe size={12} /> Website
                                                        </a>
                                                    )}
                                                    {place.google_maps_link && (
                                                        <a href={place.google_maps_link} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: '#ea4335', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                            <MapPin size={12} /> Google Maps
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                {place.phone ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        <a
                                                            href={`https://wa.me/${place.phone.replace(/[^\d+]/g, '')}?text=Hola ${place.name}, estoy interesado en sus servicios.`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="action-btn btn-whatsapp"
                                                        >
                                                            <MessageCircle size={14} /> WhatsApp
                                                        </a>
                                                        <a
                                                            href={`tel:${place.phone.replace(/[^\d+]/g, '')}`}
                                                            className="action-btn btn-call"
                                                        >
                                                            <PhoneCall size={14} /> Llamar
                                                        </a>
                                                    </div>
                                                ) : <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No phone available</span>}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    <a
                                                        href={`https://www.google.com/search?q=${encodeURIComponent(place.name + " " + place.address)}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="icon-btn google-btn"
                                                        title="Search on Google"
                                                        style={{ color: '#ea4335', padding: '6px', backgroundColor: '#fee2e2', borderRadius: '6px' }}
                                                    >
                                                        <Search size={16} />
                                                    </a>
                                                    <a
                                                        href={`https://www.facebook.com/search/top?q=${encodeURIComponent(place.name)}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="icon-btn facebook-btn"
                                                        title="Search on Facebook"
                                                        style={{ color: '#1877f2', padding: '6px', backgroundColor: '#e7f5ff', borderRadius: '6px' }}
                                                    >
                                                        <Facebook size={16} />
                                                    </a>
                                                    <a
                                                        href={`https://www.tiktok.com/search?q=${encodeURIComponent(place.name)}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="icon-btn tiktok-btn"
                                                        title="Search on TikTok"
                                                        style={{ color: '#000000', padding: '6px', backgroundColor: '#f1f1f1', borderRadius: '6px' }}
                                                    >
                                                        <Video size={16} />
                                                    </a>
                                                </div>
                                            </td>
                                            <td>
                                                <select
                                                    className={`crm-select ${getStatusColor(place.status)}`}
                                                    value={place.status}
                                                    onChange={(e) => handleUpdateStatus(originalIndex, e.target.value as any)}
                                                    style={{ width: '100%' }}
                                                >
                                                    <option value="Pendiente">Pendiente</option>
                                                    <option value="Contactado">Contactado</option>
                                                    <option value="Seguimiento">Seguimiento</option>
                                                    <option value="Agendado">Agendado</option>
                                                    <option value="Muerto">Muerto</option>
                                                </select>
                                            </td>
                                            <td>
                                                <textarea
                                                    className="crm-input"
                                                    value={place.notes}
                                                    onChange={(e) => handleUpdateNotes(originalIndex, e.target.value)}
                                                    placeholder="Add quick notes..."
                                                    rows={3}
                                                    style={{ resize: 'vertical' }}
                                                />
                                            </td>
                                            <td>
                                                {place.rating ? (
                                                    <div className="badge">
                                                        <Star size={12} style={{ marginRight: '4px', fill: 'currentColor' }} />
                                                        {place.rating} ({place.reviews})
                                                    </div>
                                                ) : <span style={{ color: 'var(--text-secondary)' }}>-</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
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
