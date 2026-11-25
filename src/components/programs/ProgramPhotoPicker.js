import {Text} from 'react-native';
import {fontFamilies} from '../../constants/typography';
// Native gallery needs an Expo picker module and a new native build.
// Keep the option honest; the browser implementation is in .web.js.
export default function ProgramPhotoPicker({colors}){
 return <Text style={{fontSize:12,fontFamily:fontFamilies.regular,color:colors.textSecondary}}>Import de photo disponible dans la version web. Choisis un visuel ci-dessous sur l’application native.</Text>;
}
