// This script will be run within the webview itself
import { randomName } from '../common/names';
import {
    PetSize,
    PetColor,
    PetType,
    Theme,
    ColorThemeKind,
    WebviewMessage,
} from '../common/types';
import { IPetType } from './states';
import {
    createPet,
    PetCollection,
    PetElement,
    IPetCollection,
    availableColors,
    InvalidPetException,
} from './pets';
import { PetElementState, PetPanelState } from './states';
import { THEMES } from './themes';
import {
    dynamicThrowOff,
    dynamicThrowOn,
    setupBallThrowing,
    throwAndChase,
} from './ball';

const FOREGROUND_EFFECT_CANVAS_ID = 'foregroundEffectCanvas';
const BACKGROUND_EFFECT_CANVAS_ID = 'backgroundEffectCanvas';
const PET_CANVAS_ID = 'ballCanvas';

/* This is how the VS Code API can be invoked from the panel */
declare global {
    interface VscodeStateApi {
        getState(): PetPanelState | undefined; // API is actually Any, but we want it to be typed.
        setState(state: PetPanelState): void;
        postMessage(message: WebviewMessage): void;
    }
    function acquireVsCodeApi(): VscodeStateApi;
}

export var allPets: IPetCollection = new PetCollection();
var petCounter: number;

function handleMouseOver(e: MouseEvent) {
    var el = e.currentTarget as HTMLDivElement;
    allPets.pets.forEach((element) => {
        if (element.collision === el && element.pet.canSwipe) {
            element.pet.swipe();
        }
    });
}

function startAnimations(
    collision: HTMLDivElement,
    pet: IPetType,
    stateApi?: VscodeStateApi,
) {
    if (!stateApi) {
        stateApi = acquireVsCodeApi();
    }

    collision.addEventListener('mouseover', handleMouseOver);
}

function addPetToPanel(
    petType: PetType,
    basePetUri: string,
    petColor: PetColor,
    petSize: PetSize,
    left: number,
    bottom: number,
    floor: number,
    name: string,
    stateApi?: VscodeStateApi,
): PetElement {
    var petSpriteElement: HTMLImageElement = document.createElement('img');
    petSpriteElement.className = 'pet';
    (document.getElementById('petsContainer') as HTMLDivElement).appendChild(
        petSpriteElement,
    );

    var collisionElement: HTMLDivElement = document.createElement('div');
    collisionElement.className = 'collision';
    (document.getElementById('petsContainer') as HTMLDivElement).appendChild(
        collisionElement,
    );

    var speechBubbleElement: HTMLDivElement = document.createElement('div');
    speechBubbleElement.className = `bubble bubble-${petSize}`;
    speechBubbleElement.innerText = 'Hello!';
    (document.getElementById('petsContainer') as HTMLDivElement).appendChild(
        speechBubbleElement,
    );

    const root = basePetUri + '/' + petType + '/' + petColor;
    console.log('Creating new pet : ', petType, root, petColor, petSize, name);
    try {
        if (!availableColors(petType).includes(petColor)) {
            throw new InvalidPetException('Invalid color for pet type');
        }
        var newPet = createPet(
            petType,
            petSpriteElement,
            collisionElement,
            speechBubbleElement,
            petSize,
            left,
            bottom,
            root,
            floor,
            name,
        );
        petCounter++;
        startAnimations(collisionElement, newPet, stateApi);
    } catch (e: any) {
        // Remove elements
        petSpriteElement.remove();
        collisionElement.remove();
        speechBubbleElement.remove();
        throw e;
    }

    return new PetElement(
        petSpriteElement,
        collisionElement,
        speechBubbleElement,
        newPet,
        petColor,
        petType,
    );
}

export function saveState(stateApi?: VscodeStateApi) {
    if (!stateApi) {
        stateApi = acquireVsCodeApi();
    }
    var state = new PetPanelState();
    state.petStates = new Array();

    allPets.pets.forEach((petItem) => {
        state.petStates?.push({
            petName: petItem.pet.name,
            petColor: petItem.color,
            petType: petItem.type,
            petState: petItem.pet.getState(),
            petFriend: petItem.pet.friend?.name ?? undefined,
            elLeft: petItem.el.style.left,
            elBottom: petItem.el.style.bottom,
        });
    });
    state.petCounter = petCounter;
    stateApi?.setState(state);
}

function recoverState(
    basePetUri: string,
    petSize: PetSize,
    floor: number,
    stateApi?: VscodeStateApi,
) {
    if (!stateApi) {
        stateApi = acquireVsCodeApi();
    }
    var state = stateApi?.getState();
    if (!state) {
        petCounter = 1;
    } else {
        if (state.petCounter === undefined || isNaN(state.petCounter)) {
            petCounter = 1;
        } else {
            petCounter = state.petCounter ?? 1;
        }
    }

    var recoveryMap: Map<IPetType, PetElementState> = new Map();
    state?.petStates?.forEach((p) => {
        // Fixes a bug related to duck animations
        if ((p.petType as string) === 'rubber duck') {
            (p.petType as string) = 'rubber-duck';
        }

        try {
            var newPet = addPetToPanel(
                p.petType ?? PetType.cat,
                basePetUri,
                p.petColor ?? PetColor.brown,
                petSize,
                parseInt(p.elLeft ?? '0'),
                parseInt(p.elBottom ?? '0'),
                floor,
                p.petName ?? randomName(p.petType ?? PetType.cat),
                stateApi,
            );
            allPets.push(newPet);
            recoveryMap.set(newPet.pet, p);
        } catch (InvalidPetException) {
            console.log(
                'State had invalid pet (' + p.petType + '), discarding.',
            );
        }
    });
    recoveryMap.forEach((state, pet) => {
        // Recover previous state.
        if (state.petState !== undefined) {
            pet.recoverState(state.petState);
        }

        // Resolve friend relationships
        var friend = undefined;
        if (state.petFriend) {
            friend = allPets.locate(state.petFriend);
            if (friend) {
                pet.recoverFriend(friend.pet);
            }
        }
    });
}

function randomStartPosition(): number {
    return Math.floor(Math.random() * (window.innerWidth * 0.7));
}

function initCanvas(name: string): HTMLCanvasElement | null {
    const canvas = document.getElementById(name) as HTMLCanvasElement;
    if (!canvas) {
        console.log('Canvas not ready');
        return null;
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (!ctx) {
        console.log('Canvas context not ready');
        return null;
    }
    ctx.canvas.width = window.innerWidth;
    ctx.canvas.height = window.innerHeight;
    return canvas;
}

// It cannot access the main VS Code APIs directly.
export function petPanelApp(
    basePetUri: string,
    theme: Theme,
    themeKind: ColorThemeKind,
    petColor: PetColor,
    petSize: PetSize,
    petType: PetType,
    throwBallWithMouse: boolean,
    disableEffects: boolean,
    stateApi?: VscodeStateApi,
) {
    if (!stateApi) {
        stateApi = acquireVsCodeApi();
    }
    const themeInfo = THEMES[theme];
    // Apply Theme backgrounds
    const foregroundEl = document.getElementById('foreground');
    const backgroundEl = document.getElementById('background');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    backgroundEl!.style.backgroundImage = themeInfo.backgroundImageUrl(
        basePetUri,
        themeKind,
        petSize,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    foregroundEl!.style.backgroundImage = themeInfo.foregroundImageUrl(
        basePetUri,
        themeKind,
        petSize,
    );
    const floor = themeInfo.floor(petSize);

    console.log(
        'Starting pet session',
        petColor,
        basePetUri,
        petType,
        throwBallWithMouse,
        theme,
    );

    // New session
    var state = stateApi?.getState();
    if (!state) {
        console.log('No state, starting a new session.');
        petCounter = 1;
        allPets.push(
            addPetToPanel(
                petType,
                basePetUri,
                petColor,
                petSize,
                randomStartPosition(),
                floor,
                floor,
                randomName(petType),
                stateApi,
            ),
        );
        saveState(stateApi);
    } else {
        console.log('Recovering state - ', state);
        recoverState(basePetUri, petSize, floor, stateApi);
    }

    initCanvas(PET_CANVAS_ID);
    setupBallThrowing(PET_CANVAS_ID, petSize, floor);

    if (throwBallWithMouse) {
        dynamicThrowOn(allPets.pets);
    } else {
        dynamicThrowOff();
    }

    // Initialize any effects
    if (themeInfo.effect) {
        const foregroundEffectCanvas = initCanvas(FOREGROUND_EFFECT_CANVAS_ID);
        const backgroundEffectCanvas = initCanvas(BACKGROUND_EFFECT_CANVAS_ID);
        if (foregroundEffectCanvas && backgroundEffectCanvas) {
            themeInfo.effect.init(
                foregroundEffectCanvas,
                backgroundEffectCanvas,
                petSize,
                floor,
                themeKind,
            );
            if (!disableEffects) {
                themeInfo.effect.enable();
            }
        }
    }

    let windowLoaded = false;
    const onTick = () => {
        if (windowLoaded) {
            allPets.seekNewFriends();
            allPets.pets.forEach((petItem) => {
                petItem.pet.nextFrame();
            });
            saveState(stateApi);
        }
    };

    window.addEventListener('load', () => {
        windowLoaded = true;
    });

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', (event): void => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'throw-with-mouse':
                if (message.enabled) {
                    dynamicThrowOn(allPets.pets);
                } else {
                    dynamicThrowOff();
                }
                break;
            case 'throw-ball':
                throwAndChase(allPets.pets);
                break;
            case 'spawn-pet':
                allPets.push(
                    addPetToPanel(
                        message.type,
                        basePetUri,
                        message.color,
                        petSize,
                        randomStartPosition(),
                        floor,
                        floor,
                        message.name ?? randomName(message.type),
                        stateApi,
                    ),
                );
                saveState(stateApi);
                break;

            case 'list-pets':
                var pets = allPets.pets;
                stateApi?.postMessage({
                    command: 'list-pets',
                    text: pets
                        .map(
                            (pet) => `${pet.type},${pet.pet.name},${pet.color}`,
                        )
                        .join('\n'),
                });
                break;

            case 'roll-call':
                var pets = allPets.pets;
                // go through every single
                // pet and then print out their name
                pets.forEach((pet) => {
                    stateApi?.postMessage({
                        command: 'info',
                        text: `${pet.pet.emoji} ${pet.pet.name} (${pet.color} ${pet.type}): ${pet.pet.hello}`,
                    });
                });
            case 'delete-pet':
                var pet = allPets.locatePet(
                    message.name,
                    message.type,
                    message.color,
                );
                if (pet) {
                    allPets.remove(pet);
                    saveState(stateApi);
                    stateApi?.postMessage({
                        command: 'info',
                        text: '👋 Removed pet ' + message.name,
                    });
                } else {
                    stateApi?.postMessage({
                        command: 'error',
                        text: `Could not find pet ${message.name}`,
                    });
                }
                break;
            case 'reset-pet':
                allPets.reset();
                petCounter = 0;
                saveState(stateApi);
                break;
            case 'pause-pet':
                petCounter = 1;
                saveState(stateApi);
                break;
            case 'disable-effects':
                if (themeInfo.effect && message.disabled) {
                    themeInfo.effect.disable();
                } else if (themeInfo.effect && !message.disabled) {
                    themeInfo.effect.enable();
                }
                break;
            case 'tick':
                onTick();
                break;
        }
    });

    window.addEventListener('resize', function () {
        initCanvas(PET_CANVAS_ID);
        initCanvas(FOREGROUND_EFFECT_CANVAS_ID);
        initCanvas(BACKGROUND_EFFECT_CANVAS_ID);

        // If current theme has an effect, handle resize
        if (themeInfo.effect) {
            themeInfo.effect.handleResize();
        }
    });
}
