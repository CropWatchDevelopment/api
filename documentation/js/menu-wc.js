'use strict';

customElements.define('compodoc-menu', class extends HTMLElement {
    constructor() {
        super();
        this.isNormalMode = this.getAttribute('mode') === 'normal';
    }

    connectedCallback() {
        this.render(this.isNormalMode);
    }

    render(isNormalMode) {
        let tp = lithtml.html(`
        <nav>
            <ul class="list">
                <li class="title">
                    <a href="index.html" data-type="index-link">api documentation</a>
                </li>

                <li class="divider"></li>
                ${ isNormalMode ? `<div id="book-search-input" role="search"><input type="text" placeholder="Type to search"></div>` : '' }
                <li class="chapter">
                    <a data-type="chapter-link" href="index.html"><span class="icon ion-ios-home"></span>Getting started</a>
                    <ul class="links">
                        <li class="link">
                            <a href="overview.html" data-type="chapter-link">
                                <span class="icon ion-ios-keypad"></span>Overview
                            </a>
                        </li>
                        <li class="link">
                            <a href="index.html" data-type="chapter-link">
                                <span class="icon ion-ios-paper"></span>README
                            </a>
                        </li>
                                <li class="link">
                                    <a href="dependencies.html" data-type="chapter-link">
                                        <span class="icon ion-ios-list"></span>Dependencies
                                    </a>
                                </li>
                                <li class="link">
                                    <a href="properties.html" data-type="chapter-link">
                                        <span class="icon ion-ios-apps"></span>Properties
                                    </a>
                                </li>
                    </ul>
                </li>
                    <li class="chapter modules">
                        <a data-type="chapter-link" href="modules.html">
                            <div class="menu-toggler linked" data-bs-toggle="collapse" ${ isNormalMode ?
                                'data-bs-target="#modules-links"' : 'data-bs-target="#xs-modules-links"' }>
                                <span class="icon ion-ios-archive"></span>
                                <span class="link-name">Modules</span>
                                <span class="icon ion-ios-arrow-down"></span>
                            </div>
                        </a>
                        <ul class="links collapse " ${ isNormalMode ? 'id="modules-links"' : 'id="xs-modules-links"' }>
                            <li class="link">
                                <a href="modules/AppModule.html" data-type="entity-link" >AppModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' : 'data-bs-target="#xs-controllers-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' :
                                            'id="xs-controllers-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' }>
                                            <li class="link">
                                                <a href="controllers/AppController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >AppController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' : 'data-bs-target="#xs-injectables-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' :
                                        'id="xs-injectables-links-module-AppModule-a28826e24ec77df2dfc88c0e459226707b262052b5adb67f742cea3b3deb4dae3867e662872e399dd1134bafbffc40c4962b60f9853c27067658ac315f0eb7fc"' }>
                                        <li class="link">
                                            <a href="injectables/AuthService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >AuthService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/AuthModule.html" data-type="entity-link" >AuthModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' : 'data-bs-target="#xs-controllers-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' :
                                            'id="xs-controllers-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' }>
                                            <li class="link">
                                                <a href="controllers/AuthController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >AuthController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' : 'data-bs-target="#xs-injectables-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' :
                                        'id="xs-injectables-links-module-AuthModule-e360b7ad85ac3805112e9828dad4ed8795ce1af3e42787b02058e099bc0fb2edd4f30e259267a410cbdc2e386276ad08251aa1a041ac462aca97d9c58713b3ff"' }>
                                        <li class="link">
                                            <a href="injectables/AuthService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >AuthService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/CwDeviceOwnersModule.html" data-type="entity-link" >CwDeviceOwnersModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' : 'data-bs-target="#xs-controllers-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' :
                                            'id="xs-controllers-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' }>
                                            <li class="link">
                                                <a href="controllers/CwDeviceOwnersController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDeviceOwnersController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' : 'data-bs-target="#xs-injectables-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' :
                                        'id="xs-injectables-links-module-CwDeviceOwnersModule-8ea60925df26917aa2c1ed290bd723768ca66d28f0671a53cb62180dc82d27d1902e657c2e3ddcbdd49a6102574fcc00ba94509a3a91e6aaff3dd7ffe7690375"' }>
                                        <li class="link">
                                            <a href="injectables/CwDeviceOwnersService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDeviceOwnersService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DeviceOwnerRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DeviceOwnerRepository</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/CwDevicesModule.html" data-type="entity-link" >CwDevicesModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' : 'data-bs-target="#xs-controllers-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' :
                                            'id="xs-controllers-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' }>
                                            <li class="link">
                                                <a href="controllers/CwDevicesController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDevicesController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' : 'data-bs-target="#xs-injectables-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' :
                                        'id="xs-injectables-links-module-CwDevicesModule-d56e3d20c09f8e98a55793470ec76b6249ff6c36c14ee83f5f4cac0a968db50b74c5c0bef435815f104c4197b674ee1e4235798ade36fe35764899a8606ccad8"' }>
                                        <li class="link">
                                            <a href="injectables/CwDevicesService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDevicesService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DeviceRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DeviceRepository</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/CwDeviceTypeModule.html" data-type="entity-link" >CwDeviceTypeModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' : 'data-bs-target="#xs-controllers-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' :
                                            'id="xs-controllers-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' }>
                                            <li class="link">
                                                <a href="controllers/CwDeviceTypeController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDeviceTypeController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' : 'data-bs-target="#xs-injectables-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' :
                                        'id="xs-injectables-links-module-CwDeviceTypeModule-11e5266b8af04b747894117bd070afd0f45a378c9b508e0e9b8a790adfeb4dad2a110df047f4af39cf500db7ef53fb40eccb252b6f84fe21c3dd146533bbacc4"' }>
                                        <li class="link">
                                            <a href="injectables/CwDeviceTypeService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDeviceTypeService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DeviceTypeRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DeviceTypeRepository</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/DataModule.html" data-type="entity-link" >DataModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' : 'data-bs-target="#xs-controllers-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' :
                                            'id="xs-controllers-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' }>
                                            <li class="link">
                                                <a href="controllers/DataController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DataController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' : 'data-bs-target="#xs-injectables-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' :
                                        'id="xs-injectables-links-module-DataModule-90b920168828c7dafd445cdc3857d7fb15131091c34a3f6982b955eb5e5a16b91d11877d909d453363d585113d067ad097e89497dea3e2c3d6ac890fa4b5662f"' }>
                                        <li class="link">
                                            <a href="injectables/CwDeviceOwnersService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDeviceOwnersService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/CwDeviceTypeService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDeviceTypeService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/CwDevicesService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >CwDevicesService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DataRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DataRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DataService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DataService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DeviceOwnerRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DeviceOwnerRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DeviceRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DeviceRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DeviceTypeRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DeviceTypeRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/SupabaseService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >SupabaseService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/GeolocationModule.html" data-type="entity-link" >GeolocationModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' : 'data-bs-target="#xs-controllers-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' :
                                            'id="xs-controllers-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' }>
                                            <li class="link">
                                                <a href="controllers/GeolocationController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >GeolocationController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' : 'data-bs-target="#xs-injectables-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' :
                                        'id="xs-injectables-links-module-GeolocationModule-159e5d081d4a6fa0073c8845a8611a2130e07cc7aeadba1708ab7b727788490395dd03cd1df89aed6fd226dc508d0af45d98128c23b5f1a5872d04d04ac75a04"' }>
                                        <li class="link">
                                            <a href="injectables/AuthService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >AuthService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/GeolocationService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >GeolocationService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/HealthModule.html" data-type="entity-link" >HealthModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-HealthModule-23e62372dae323ef0619a44019786c63b9d7da80db2b66fcda234e5788831a9d66507cf9f71bd2458d0b6b80fd9845711dcf21d9f468a6e7955759162692e8b8"' : 'data-bs-target="#xs-controllers-links-module-HealthModule-23e62372dae323ef0619a44019786c63b9d7da80db2b66fcda234e5788831a9d66507cf9f71bd2458d0b6b80fd9845711dcf21d9f468a6e7955759162692e8b8"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-HealthModule-23e62372dae323ef0619a44019786c63b9d7da80db2b66fcda234e5788831a9d66507cf9f71bd2458d0b6b80fd9845711dcf21d9f468a6e7955759162692e8b8"' :
                                            'id="xs-controllers-links-module-HealthModule-23e62372dae323ef0619a44019786c63b9d7da80db2b66fcda234e5788831a9d66507cf9f71bd2458d0b6b80fd9845711dcf21d9f468a6e7955759162692e8b8"' }>
                                            <li class="link">
                                                <a href="controllers/HealthController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >HealthController</a>
                                            </li>
                                        </ul>
                                    </li>
                            </li>
                            <li class="link">
                                <a href="modules/LocationModule.html" data-type="entity-link" >LocationModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' : 'data-bs-target="#xs-controllers-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' :
                                            'id="xs-controllers-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' }>
                                            <li class="link">
                                                <a href="controllers/LocationController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >LocationController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' : 'data-bs-target="#xs-injectables-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' :
                                        'id="xs-injectables-links-module-LocationModule-a162ec0e519865f6a9f88a3447628f58e5e2630c4dc4a298ecec34fc6277bd9de26fc3d8b0e3f2f431e4bb8518503a46593c55e2c8c7c8f9d641078198f02110"' }>
                                        <li class="link">
                                            <a href="injectables/LocationRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >LocationRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/LocationService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >LocationService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/PdfModule.html" data-type="entity-link" >PdfModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' : 'data-bs-target="#xs-controllers-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' :
                                            'id="xs-controllers-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' }>
                                            <li class="link">
                                                <a href="controllers/PdfController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >PdfController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' : 'data-bs-target="#xs-injectables-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' :
                                        'id="xs-injectables-links-module-PdfModule-92303bd70fdbede05428fc959a155109d41ef66c76a65ea6bb82b544bfef36ce8fbf542677dfceabf1a62fdeb2daf7366219592fe0757df899f57b7e9e5d1fb1"' }>
                                        <li class="link">
                                            <a href="injectables/AuthService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >AuthService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/DataService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >DataService</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/PdfService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >PdfService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/ProfilesModule.html" data-type="entity-link" >ProfilesModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' : 'data-bs-target="#xs-controllers-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' :
                                            'id="xs-controllers-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' }>
                                            <li class="link">
                                                <a href="controllers/ProfilesController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >ProfilesController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' : 'data-bs-target="#xs-injectables-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' :
                                        'id="xs-injectables-links-module-ProfilesModule-bad10a20e4f7460f0bad04338af2bf2c120b302b7f402d412ee72aee54a2dea7fec74479365889061c65d2114998d661c80bcef9d576e47d85119d99ee69aad4"' }>
                                        <li class="link">
                                            <a href="injectables/ProfileRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >ProfileRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/ProfilesService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >ProfilesService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/RelayModule.html" data-type="entity-link" >RelayModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' : 'data-bs-target="#xs-controllers-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' :
                                            'id="xs-controllers-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' }>
                                            <li class="link">
                                                <a href="controllers/RelayController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >RelayController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' : 'data-bs-target="#xs-injectables-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' :
                                        'id="xs-injectables-links-module-RelayModule-2a735e24f62a14677b61fb7348ddffaa542c54a03a27cdd618b3792c3305408d1fe0e6da565118f55db1845be43edcb21dc904c2478b6a198be7ea0ba30b5ab6"' }>
                                        <li class="link">
                                            <a href="injectables/RelayService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >RelayService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/ReportsTemplatesModule.html" data-type="entity-link" >ReportsTemplatesModule</a>
                                    <li class="chapter inner">
                                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                            'data-bs-target="#controllers-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' : 'data-bs-target="#xs-controllers-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' }>
                                            <span class="icon ion-md-swap"></span>
                                            <span>Controllers</span>
                                            <span class="icon ion-ios-arrow-down"></span>
                                        </div>
                                        <ul class="links collapse" ${ isNormalMode ? 'id="controllers-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' :
                                            'id="xs-controllers-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' }>
                                            <li class="link">
                                                <a href="controllers/ReportsTemplatesController.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >ReportsTemplatesController</a>
                                            </li>
                                        </ul>
                                    </li>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' : 'data-bs-target="#xs-injectables-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' :
                                        'id="xs-injectables-links-module-ReportsTemplatesModule-065a2fc9fff1e8cc53a5e1ca2ae74cb5c53faca49810a67da53f5af719c9bb006e8e13e5d51158ca61f111da78f92a0723a3324ff758df86c483f7f3a81d90ef"' }>
                                        <li class="link">
                                            <a href="injectables/ReportTemplatesRepository.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >ReportTemplatesRepository</a>
                                        </li>
                                        <li class="link">
                                            <a href="injectables/ReportsTemplatesService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >ReportsTemplatesService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                            <li class="link">
                                <a href="modules/SupabaseModule.html" data-type="entity-link" >SupabaseModule</a>
                                <li class="chapter inner">
                                    <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ?
                                        'data-bs-target="#injectables-links-module-SupabaseModule-ef6f368e1f9fe99063a07901898f8eba960214c4f9f01bc5de3a400d7e64d8f97a734803059d75d4181e790d25a4d12bc57db0b433a2f9d78dc3bd0468b8ed92"' : 'data-bs-target="#xs-injectables-links-module-SupabaseModule-ef6f368e1f9fe99063a07901898f8eba960214c4f9f01bc5de3a400d7e64d8f97a734803059d75d4181e790d25a4d12bc57db0b433a2f9d78dc3bd0468b8ed92"' }>
                                        <span class="icon ion-md-arrow-round-down"></span>
                                        <span>Injectables</span>
                                        <span class="icon ion-ios-arrow-down"></span>
                                    </div>
                                    <ul class="links collapse" ${ isNormalMode ? 'id="injectables-links-module-SupabaseModule-ef6f368e1f9fe99063a07901898f8eba960214c4f9f01bc5de3a400d7e64d8f97a734803059d75d4181e790d25a4d12bc57db0b433a2f9d78dc3bd0468b8ed92"' :
                                        'id="xs-injectables-links-module-SupabaseModule-ef6f368e1f9fe99063a07901898f8eba960214c4f9f01bc5de3a400d7e64d8f97a734803059d75d4181e790d25a4d12bc57db0b433a2f9d78dc3bd0468b8ed92"' }>
                                        <li class="link">
                                            <a href="injectables/SupabaseService.html" data-type="entity-link" data-context="sub-entity" data-context-id="modules" >SupabaseService</a>
                                        </li>
                                    </ul>
                                </li>
                            </li>
                </ul>
                </li>
                    <li class="chapter">
                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ? 'data-bs-target="#classes-links"' :
                            'data-bs-target="#xs-classes-links"' }>
                            <span class="icon ion-ios-paper"></span>
                            <span>Classes</span>
                            <span class="icon ion-ios-arrow-down"></span>
                        </div>
                        <ul class="links collapse " ${ isNormalMode ? 'id="classes-links"' : 'id="xs-classes-links"' }>
                            <li class="link">
                                <a href="classes/BaseController.html" data-type="entity-link" >BaseController</a>
                            </li>
                            <li class="link">
                                <a href="classes/BaseRepository.html" data-type="entity-link" >BaseRepository</a>
                            </li>
                            <li class="link">
                                <a href="classes/BaseService.html" data-type="entity-link" >BaseService</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateDatumDto.html" data-type="entity-link" >CreateDatumDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateDeviceDto.html" data-type="entity-link" >CreateDeviceDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateDeviceOwnerDto.html" data-type="entity-link" >CreateDeviceOwnerDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateDeviceTypeDto.html" data-type="entity-link" >CreateDeviceTypeDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateLocationDto.html" data-type="entity-link" >CreateLocationDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateProfileDto.html" data-type="entity-link" >CreateProfileDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/CreateReportTemplateDto.html" data-type="entity-link" >CreateReportTemplateDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/Datum.html" data-type="entity-link" >Datum</a>
                            </li>
                            <li class="link">
                                <a href="classes/Location.html" data-type="entity-link" >Location</a>
                            </li>
                            <li class="link">
                                <a href="classes/LoginDto.html" data-type="entity-link" >LoginDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/PdfDTO.html" data-type="entity-link" >PdfDTO</a>
                            </li>
                            <li class="link">
                                <a href="classes/Profile.html" data-type="entity-link" >Profile</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateDatumDto.html" data-type="entity-link" >UpdateDatumDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateDeviceDto.html" data-type="entity-link" >UpdateDeviceDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateDeviceOwnerDto.html" data-type="entity-link" >UpdateDeviceOwnerDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateDeviceTypeDto.html" data-type="entity-link" >UpdateDeviceTypeDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateLocationDto.html" data-type="entity-link" >UpdateLocationDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateProfileDto.html" data-type="entity-link" >UpdateProfileDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UpdateReportDto.html" data-type="entity-link" >UpdateReportDto</a>
                            </li>
                            <li class="link">
                                <a href="classes/UserAuthDto.html" data-type="entity-link" >UserAuthDto</a>
                            </li>
                        </ul>
                    </li>
                        <li class="chapter">
                            <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ? 'data-bs-target="#injectables-links"' :
                                'data-bs-target="#xs-injectables-links"' }>
                                <span class="icon ion-md-arrow-round-down"></span>
                                <span>Injectables</span>
                                <span class="icon ion-ios-arrow-down"></span>
                            </div>
                            <ul class="links collapse " ${ isNormalMode ? 'id="injectables-links"' : 'id="xs-injectables-links"' }>
                                <li class="link">
                                    <a href="injectables/AppService.html" data-type="entity-link" >AppService</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/DataRepository.html" data-type="entity-link" >DataRepository</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/DeviceOwnerRepository.html" data-type="entity-link" >DeviceOwnerRepository</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/DeviceRepository.html" data-type="entity-link" >DeviceRepository</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/DeviceTypeRepository.html" data-type="entity-link" >DeviceTypeRepository</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/HttpCacheInterceptor.html" data-type="entity-link" >HttpCacheInterceptor</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/LocationRepository.html" data-type="entity-link" >LocationRepository</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/ProfileRepository.html" data-type="entity-link" >ProfileRepository</a>
                                </li>
                                <li class="link">
                                    <a href="injectables/ReportTemplatesRepository.html" data-type="entity-link" >ReportTemplatesRepository</a>
                                </li>
                            </ul>
                        </li>
                    <li class="chapter">
                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ? 'data-bs-target="#guards-links"' :
                            'data-bs-target="#xs-guards-links"' }>
                            <span class="icon ion-ios-lock"></span>
                            <span>Guards</span>
                            <span class="icon ion-ios-arrow-down"></span>
                        </div>
                        <ul class="links collapse " ${ isNormalMode ? 'id="guards-links"' : 'id="xs-guards-links"' }>
                            <li class="link">
                                <a href="guards/JwtAuthGuard.html" data-type="entity-link" >JwtAuthGuard</a>
                            </li>
                            <li class="link">
                                <a href="guards/SupabaseAuthGuard.html" data-type="entity-link" >SupabaseAuthGuard</a>
                            </li>
                        </ul>
                    </li>
                    <li class="chapter">
                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ? 'data-bs-target="#interfaces-links"' :
                            'data-bs-target="#xs-interfaces-links"' }>
                            <span class="icon ion-md-information-circle-outline"></span>
                            <span>Interfaces</span>
                            <span class="icon ion-ios-arrow-down"></span>
                        </div>
                        <ul class="links collapse " ${ isNormalMode ? ' id="interfaces-links"' : 'id="xs-interfaces-links"' }>
                            <li class="link">
                                <a href="interfaces/BaseServiceInterface.html" data-type="entity-link" >BaseServiceInterface</a>
                            </li>
                            <li class="link">
                                <a href="interfaces/BaseServiceInterface-1.html" data-type="entity-link" >BaseServiceInterface</a>
                            </li>
                            <li class="link">
                                <a href="interfaces/FindAllParams.html" data-type="entity-link" >FindAllParams</a>
                            </li>
                            <li class="link">
                                <a href="interfaces/IRepositoryBase.html" data-type="entity-link" >IRepositoryBase</a>
                            </li>
                            <li class="link">
                                <a href="interfaces/RepositoryInterface.html" data-type="entity-link" >RepositoryInterface</a>
                            </li>
                        </ul>
                    </li>
                    <li class="chapter">
                        <div class="simple menu-toggler" data-bs-toggle="collapse" ${ isNormalMode ? 'data-bs-target="#miscellaneous-links"'
                            : 'data-bs-target="#xs-miscellaneous-links"' }>
                            <span class="icon ion-ios-cube"></span>
                            <span>Miscellaneous</span>
                            <span class="icon ion-ios-arrow-down"></span>
                        </div>
                        <ul class="links collapse " ${ isNormalMode ? 'id="miscellaneous-links"' : 'id="xs-miscellaneous-links"' }>
                            <li class="link">
                                <a href="miscellaneous/enumerations.html" data-type="entity-link">Enums</a>
                            </li>
                            <li class="link">
                                <a href="miscellaneous/functions.html" data-type="entity-link">Functions</a>
                            </li>
                            <li class="link">
                                <a href="miscellaneous/typealiases.html" data-type="entity-link">Type aliases</a>
                            </li>
                            <li class="link">
                                <a href="miscellaneous/variables.html" data-type="entity-link">Variables</a>
                            </li>
                        </ul>
                    </li>
                    <li class="chapter">
                        <a data-type="chapter-link" href="coverage.html"><span class="icon ion-ios-stats"></span>Documentation coverage</a>
                    </li>
                    <li class="divider"></li>
                    <li class="copyright">
                        Documentation generated using <a href="https://compodoc.app/" target="_blank" rel="noopener noreferrer">
                            <img data-src="images/compodoc-vectorise.png" class="img-responsive" data-type="compodoc-logo">
                        </a>
                    </li>
            </ul>
        </nav>
        `);
        this.innerHTML = tp.strings;
    }
});