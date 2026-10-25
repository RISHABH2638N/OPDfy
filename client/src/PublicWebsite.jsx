import React from 'react';
import {useLocation} from 'react-router-dom';
import PublicLayout from './PublicLayout';
import LandingPage from './LandingPage';
import PublicInfoPage from './PublicPages';
import NotFoundPage from './NotFoundPage';
import {isPublicPage} from './seo';
export default function PublicWebsite(){
 const {pathname}=useLocation();
 return <PublicLayout>{pathname==='/'?<LandingPage/>:isPublicPage(pathname)?<PublicInfoPage key={pathname} kind={pathname.slice(1)}/>:<NotFoundPage/>}</PublicLayout>;
}
