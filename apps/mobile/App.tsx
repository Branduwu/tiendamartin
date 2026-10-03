import { ScrollView, StyleSheet, Text } from "react-native";

export default function App() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        SmartRetail
      </Text>
      <Text style={styles.text}>Inventario y punto de venta.</Text>
      <Text style={styles.text}>
        Aplicación móvil inicializada correctamente.
      </Text>
      <Text style={styles.text}>iOS · Android</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 64,
    backgroundColor: "#f5f7fa",
    gap: 16,
  },
  title: { fontSize: 32, fontWeight: "700", color: "#172b3a" },
  text: { fontSize: 18, lineHeight: 28, color: "#172b3a" },
});
